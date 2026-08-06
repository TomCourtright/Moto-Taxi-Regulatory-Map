// Build data/documents.json (drawer manifest) and data/documents-sources.csv
// (link-of-last-resort ledger) from whatever is actually on disk. PRD.md §6.
//
//     node scripts/build-documents.mjs
//
// Two outputs, because they answer different questions:
//
//   documents.json         what the drawer should show, keyed by ISO3
//   documents-sources.csv  every original URL we know of, including the ones
//                          that failed to download and the ones we have no
//                          local copy of. If the documents/ tree is ever lost,
//                          this CSV is enough to re-fetch everything.
//
// Human edits to `title`, `language` and `year` in documents.json are PRESERVED
// across runs — the derived title from a filename is only a starting point, and
// a regulator-facing document list deserves better than "36 Securite Des
// Transports". Everything else is re-derived each run.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { resolveISO3 } from '../src/iso3.js';
import { classifyHost } from '../src/sources.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DOCS_DIR = join(ROOT, 'documents');
const INVENTORY = join(ROOT, 'data', 'inventory.json');
const OUT_JSON = join(ROOT, 'data', 'documents.json');
const OUT_CSV = join(ROOT, 'data', 'documents-sources.csv');

// Anything we would not want to hand a regulator as a "document".
const IGNORE = new Set(['.md', '.json', '.bin', '.gitkeep', '']);

const readJSON = (p, fallback) => {
  if (!existsSync(p)) return fallback;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fallback; }
};

// Strip the 8-hex uniqueness suffix download_sources.py appends, then make the
// slug readable. Deliberately crude — it is a placeholder for a human title.
function titleFromFilename(file) {
  return basename(file, extname(file))
    .replace(/-[0-9a-f]{8}$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase()) || basename(file);
}

// A scraped "document" is sometimes a bot-challenge or a JavaScript-required
// stub that the fetcher happily stored with HTTP 200. Presenting one of those in
// the drawer as "Code de la route" would put a Cloudflare error page in front of
// a national regulator under a GNPT byline, so they are refused entry here.
//
// Deliberately conservative: a page must be BOTH near-empty and carry a known
// challenge/error marker. Real legislation runs to thousands of characters.
const JUNK_MARKERS = /client challenge|enable javascript|just a moment|checking your browser|access denied|cf-browser-verification|attention required|403 forbidden|are you a robot|captcha|verify you are human|page not found/i;
const JUNK_TEXT_LIMIT = 1000;

function junkReason(full, ext) {
  if (!['.html', '.htm'].includes(ext)) return null;
  let raw;
  try { raw = readFileSync(full, 'utf8'); } catch { return null; }

  const text = raw
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length >= JUNK_TEXT_LIMIT) return null;
  const hit = text.slice(0, 3000).match(JUNK_MARKERS);
  return hit ? `${hit[0]} (${text.length} chars of text)` : null;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

// ---------------------------------------------------------------------------

const inventory = readJSON(INVENTORY, []);
const previous = readJSON(OUT_JSON, {});

// saved_to path -> inventory entry, so a file on disk can find its origin URL.
const bySavedPath = new Map();
for (const e of inventory) {
  if (e.saved_to) bySavedPath.set(e.saved_to.replace(/\\/g, '/'), e);
}

// Preserve human-authored metadata from the last run, keyed on the file path.
const humanEdits = new Map();
for (const list of Object.values(previous)) {
  for (const d of list ?? []) {
    humanEdits.set(d.path, {
      title: d.titleEdited ? d.title : undefined,
      language: d.language ?? undefined,
      year: d.year ?? undefined,
      titleEdited: d.titleEdited ?? false,
      official: typeof d.official === 'boolean' ? d.official : undefined,
    });
  }
}

const manifest = {};
const unresolved = new Set();
const rejected = [];
const duplicates = [];
const seenContent = new Map();   // sha1 -> first path that had it
let fileCount = 0;

if (existsSync(DOCS_DIR)) {
  for (const full of walk(DOCS_DIR)) {
    const ext = extname(full).toLowerCase();
    if (IGNORE.has(ext)) continue;

    const relPath = relative(ROOT, full).replace(/\\/g, '/');
    // documents/<Country-Name>/<file>. Hyphens usually stand in for spaces, but
    // some country names genuinely contain one (Guinea-Bissau, Timor-Leste), so
    // try the folder name as-is before de-hyphenating it.
    const folder = relative(DOCS_DIR, full).replace(/\\/g, '/').split('/')[0];
    const iso3 = resolveISO3(folder) ?? resolveISO3(folder.replace(/-/g, ' '));

    if (!iso3) { unresolved.add(folder); continue; }

    const junk = junkReason(full, ext);
    if (junk) { rejected.push({ path: relPath, reason: junk }); continue; }

    // The same instrument often sits behind two URL forms, which the fetcher
    // stores twice. Keep the first and drop the rest so the drawer does not list
    // one law twice.
    const sha = createHash('sha1').update(readFileSync(full)).digest('hex');
    if (seenContent.has(sha)) {
      duplicates.push({ path: relPath, sameAs: seenContent.get(sha) });
      continue;
    }
    seenContent.set(sha, relPath);

    const inv = bySavedPath.get(relPath);
    const kept = humanEdits.get(relPath) ?? {};
    const bytes = statSync(full).size;
    const origin = inv?.final_url ?? inv?.url ?? null;
    const host = origin ? classifyHost(origin) : null;

    (manifest[iso3] ??= []).push({
      path: relPath,
      kind: ext.replace('.', ''),
      title: kept.titleEdited ? kept.title : titleFromFilename(full),
      titleEdited: kept.titleEdited ?? false,
      language: kept.language ?? null,
      year: kept.year ?? null,
      // Derived from the serving host, so it stays consistent across hundreds of
      // entries. Only ever used to ADD an "official source" marker — never to
      // brand something unofficial, which the host alone cannot establish.
      // A hand-set boolean survives regeneration (manually dropped files have no
      // URL to derive from).
      official: host ? host.official : (kept.official ?? null),
      thirdParty: host ? host.thirdParty : null,
      host: host?.host || null,
      bytes,
      pages: inv?.page_count ?? null,
      scanned: inv?.likely_scanned ?? null,
      originalUrl: origin,
    });
    fileCount++;
  }
}

for (const list of Object.values(manifest)) {
  list.sort((a, b) => a.title.localeCompare(b.title));
}

writeFileSync(OUT_JSON, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

// --- fallback ledger -------------------------------------------------------
// Every URL we know about, whether or not we hold a copy. This is the file that
// makes the local PDFs disposable rather than precious.
const csvEsc = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const rows = [['country', 'iso3', 'url', 'final_url', 'status', 'kind', 'bytes', 'local_path']];
for (const e of inventory) {
  const country = e.primary_country ?? (e.countries ?? [])[0] ?? '';
  rows.push([
    country,
    resolveISO3(country) ?? '',
    e.url ?? '',
    e.final_url ?? '',
    e.status ?? '',
    e.kind ?? '',
    e.bytes ?? '',
    (e.saved_to ?? '').replace(/\\/g, '/'),
  ]);
}
writeFileSync(OUT_CSV, rows.map((r) => r.map(csvEsc).join(',')).join('\n') + '\n', 'utf8');

// --- report ----------------------------------------------------------------
const countries = Object.keys(manifest).length;
console.log(`documents.json   ${fileCount} file(s) across ${countries} countr${countries === 1 ? 'y' : 'ies'}`);
console.log(`documents-sources.csv   ${inventory.length} source URL(s)`);

if (rejected.length) {
  console.log(`\n${rejected.length} capture(s) refused as bot-challenge / error pages:`);
  for (const r of rejected) console.log(`   ${r.path}\n      ${r.reason}`);
  console.log(`   The Source citation still links these out; only the bogus local copy is withheld.`);
}

if (duplicates.length) {
  console.log(`\n${duplicates.length} duplicate capture(s) skipped (byte-identical to another file):`);
  for (const d of duplicates) console.log(`   ${d.path}\n      same as ${d.sameAs}`);
}

const withoutOrigin = Object.values(manifest).flat().filter((d) => !d.originalUrl);
if (withoutOrigin.length) {
  console.log(`\n${withoutOrigin.length} file(s) with no recorded origin URL (manually dropped in):`);
  for (const d of withoutOrigin) console.log(`   ${d.path}`);
}

// A folder name that does not resolve means those documents are invisible on the
// site. Report loudly rather than dropping silently — PRD.md §9.
if (unresolved.size) {
  console.error(`\nUNRESOLVED folder name(s) — documents in these are NOT on the site:`);
  for (const f of unresolved) console.error(`   documents/${f}`);
  console.error(`Rename to a country name the atlas knows, or add an alias in src/iso3.js.`);
  process.exitCode = 1;
}
