// Suggestions-only pass over every Source cell in the master sheet.
//
//   node scripts/source-review.mjs
//
// Reads the live sheet, applies deterministic cleanups to each source entry,
// and writes source-review.html — a browseable page with per-cell Copy buttons
// so you can paste the proposed value straight into Google Sheets.
//
// What this tool DOES:
//   - Parses existing entries into the Citation | URL | pinpoint format
//   - Extracts citations from known URL patterns (Kenya Law, Indonesian BPK,
//     Vietnamese thuvienphapluat, gov.uk-style paths)
//   - Normalises separators (semicolons → newlines per SOURCES.md)
//   - Flags third-party mirrors, missing citations, non-http scraps
//
// What this tool DOES NOT do:
//   - Invent citations from thin air
//   - Fetch pages (no network calls beyond the sheet itself)
//   - Guess at law numbers, years, or article references not literally in the URL
//   - Modify the sheet — output is HTML only, copy-paste is manual

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildAtlas } from '../src/parse-atlas.js';
import { parseSources, splitSources } from '../src/sources.js';
import { resolveISO3 } from '../src/iso3.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQtzoKLQsRshikHltqLvDxYInnl0qyu-SyK00' +
  'eEaIQSl-xoDEwadn2TXIt3QT7niB2tKvOs-KGPye_g/pub?gid=1544705327&single=true&output=csv';

// ---------------------------------------------------------------------------
// URL → citation heuristics. Each pattern below matches a very specific URL
// shape and yields fields we can trust *because they are literally in the URL*.
// If nothing matches, we leave the entry untouched with a "needs citation" tag.
// ---------------------------------------------------------------------------

const PATTERNS = [
  {
    // Kenya Law Akoma Ntoso legal notices, e.g.
    //   https://new.kenyalaw.org/akn/ke/act/ln/2015/19/eng@2015-03-06
    id: 'kenyalaw-ln',
    match: /kenyalaw\.org\/akn\/ke\/act\/ln\/(\d{4})\/(\d+)/i,
    build: ([, year, num]) => ({
      citation: `Legal Notice ${num} of ${year} (Kenya, ${year})`,
      confidence: 'high',
    }),
  },
  {
    // Kenya Law Akoma Ntoso caps, e.g.
    //   https://new.kenyalaw.org/akn/ke/act/cap/403/eng@2012-12-31
    id: 'kenyalaw-cap',
    match: /kenyalaw\.org\/akn\/ke\/act\/cap\/(\d+[A-Z]?)\/eng@(\d{4})/i,
    build: ([, cap, year]) => ({
      citation: `Traffic Act Cap. ${cap} (Kenya, ${year})`,
      confidence: 'medium', // we don't know for sure it's Traffic Act specifically
    }),
  },
  {
    // Indonesian BPK legal database: the filename holds a readable reg number.
    //   https://peraturan.bpk.go.id/Details/104095/permenhub-no-12-tahun-2019
    id: 'bpk-indonesia',
    match: /peraturan\.bpk\.go\.id\/[^\/]+\/\d+\/([a-z0-9\-]+)/i,
    build: ([, slug]) => {
      // permenhub-no-12-tahun-2019 → Permenhub No. 12 Tahun 2019
      const pretty = slug
        .replace(/-/g, ' ')
        .replace(/\bno\b/i, 'No.')
        .replace(/\btahun\b/i, 'Tahun')
        .replace(/^\w/, (c) => c.toUpperCase());
      const yearMatch = slug.match(/(19|20)\d{2}/);
      const year = yearMatch ? yearMatch[0] : null;
      return {
        citation: year ? `${pretty} (Indonesia, ${year})` : `${pretty} (Indonesia)`,
        confidence: 'medium',
      };
    },
  },
  {
    // Vietnam legal database: number in URL segment.
    //   https://thuvienphapluat.vn/van-ban/EN/Giao-thong-Van-tai/Law-36-2024-QH15-Road-...
    id: 'vietnam-law',
    match: /thuvienphapluat\.vn\/van-ban\/EN\/[^\/]+\/([A-Za-z]+-\d+-\d{4}[^\/]*)/,
    build: ([, slug]) => {
      const parts = slug.split('-');
      const type = parts[0]; const num = parts[1]; const year = parts[2];
      const rest = parts.slice(3).join(' ').replace(/\bQH\d+\b/i, '');
      const title = rest.trim() ? ` (${rest.trim()})` : '';
      return {
        citation: `${type} ${num}/${year}${title} (Vietnam, ${year})`,
        confidence: 'medium',
      };
    },
  },
  {
    // Any URL with a filename that looks like a document name.
    //   https://example.gov/downloads/Traffic-Act-2015.pdf
    id: 'filename',
    match: /\/([A-Za-z][A-Za-z0-9._\-]{6,})\.(pdf|docx?|htm|html)(?:$|\?)/i,
    build: ([, name]) => ({
      citation: name.replace(/[-_]+/g, ' ').replace(/\.\w+$/, '').trim(),
      confidence: 'low', // filename ≠ document title, but better than nothing
    }),
  },
];

function extractFromURL(url) {
  for (const p of PATTERNS) {
    const m = url.match(p.match);
    if (m) return { ...p.build(m), pattern: p.id };
  }
  return null;
}

// ---------------------------------------------------------------------------

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();

function normaliseEntry(entry) {
  const parsed = entry;
  const bits = [];

  if (parsed.citation) bits.push(parsed.citation);
  if (parsed.url)      bits.push(parsed.url);
  if (parsed.pinpoint) bits.push(parsed.pinpoint);

  return bits.join(' | ');
}

// Returns { proposed, changes: [ {kind, was, becomes, confidence, note} ] }
function reviewCell(raw) {
  const originalEntries = splitSources(raw);
  const parsed = parseSources(raw);

  const out = [];
  const changes = [];
  let confidence = 'high';    // gets downgraded by anything ambiguous

  for (let i = 0; i < parsed.length; i++) {
    const orig = originalEntries[i];
    const p = parsed[i];

    // Case 1: URL only — try to derive a citation from the URL itself.
    if (p.untitled && p.url) {
      const guess = extractFromURL(p.url);
      if (guess) {
        const rebuilt = {
          citation: guess.citation,
          url: p.url,
          pinpoint: p.pinpoint,
        };
        out.push(normaliseEntry(rebuilt));
        changes.push({
          kind: 'citation-from-url',
          was: orig,
          becomes: normaliseEntry(rebuilt),
          confidence: guess.confidence,
          note: `Citation derived from URL (${guess.pattern}) — verify.`,
        });
        if (guess.confidence === 'low' || confidence === 'low') confidence = 'low';
        else if (guess.confidence === 'medium' && confidence !== 'low') confidence = 'medium';
        continue;
      }

      // Nothing we can do — leave it alone but flag it.
      out.push(orig);
      changes.push({
        kind: 'needs-manual',
        was: orig,
        becomes: orig,
        confidence: 'unknown',
        note: `Bare URL, no known pattern. Needs a hand-written citation.`,
      });
      confidence = 'low';
      continue;
    }

    // Case 2: has citation, possibly also URL/pinpoint. Reformat to the
    // pipe-separated shape without changing meaning.
    const rebuilt = {
      citation: p.citation,
      url: p.url,
      pinpoint: p.pinpoint,
    };
    const proposedLine = normaliseEntry(rebuilt);
    if (norm(proposedLine) !== norm(orig)) {
      changes.push({
        kind: 'reformat',
        was: orig,
        becomes: proposedLine,
        confidence: 'high',
        note: 'Reformatted into Citation | URL | pinpoint (no meaning change).',
      });
    }
    out.push(proposedLine);
  }

  const proposed = out.join('\n');
  const wasSemi = /;/.test(raw);
  if (wasSemi && !/;/.test(proposed) && parsed.length > 1) {
    changes.push({
      kind: 'newline-separator',
      was: '(semicolons)',
      becomes: '(newlines)',
      confidence: 'high',
      note: 'Multiple sources now separated by newline (Alt+Enter in Sheets).',
    });
  }

  return {
    proposed,
    changes,
    unchanged: proposed === raw,
    confidence,
  };
}

// ---------------------------------------------------------------------------

process.stdout.write('Fetching live sheet… ');
const res = await fetch(SHEET_CSV);
if (!res.ok) { console.error('FAILED', res.status); process.exit(1); }
const csv = await res.text();
console.log(`ok (${csv.length.toLocaleString()} bytes)`);

const atlas = buildAtlas(csv, { resolveISO3 });

// Walk every country × indicator with a source. The parser already dropped
// legislation indicator into c.statusSource, and other requirements into
// c.indicators[slug].source — same shape for both.

const rows = [];
for (const c of atlas.countries) {
  const cells = [];

  if (c.statusSource) {
    cells.push({
      country: c.name,
      iso3: c.iso3,
      indicator: 'Legislation Addressing Moto-Taxis',
      slug: '__legislation__',
      raw: c.statusSource,
      review: reviewCell(c.statusSource),
    });
  }
  for (const ind of atlas.indicators) {
    if (ind.isLegislation) continue;
    const rec = c.indicators[ind.slug];
    if (!rec?.source) continue;
    cells.push({
      country: c.name,
      iso3: c.iso3,
      indicator: ind.name,
      slug: ind.slug,
      raw: rec.source,
      review: reviewCell(rec.source),
    });
  }
  if (cells.length) rows.push({ country: c.name, iso3: c.iso3, cells });
}

// ---------------------------------------------------------------------------

// Stats: only count confidence buckets for cells where a change is proposed.
// The other cells are just fine as they are and don't need reviewing.
const totals = { cells: 0, alreadyClean: 0, changed: 0, high: 0, medium: 0, low: 0, needsManual: 0 };
for (const g of rows) for (const c of g.cells) {
  totals.cells++;
  const kinds = c.review.changes.map((x) => x.kind);
  const needsManual = kinds.includes('needs-manual');
  const isChange = !c.review.unchanged;

  if (needsManual) totals.needsManual++;
  if (isChange) {
    totals.changed++;
    if (c.review.confidence === 'high') totals.high++;
    else if (c.review.confidence === 'medium') totals.medium++;
    else if (c.review.confidence === 'low') totals.low++;
  } else if (!needsManual) {
    totals.alreadyClean++;
  }
}

console.log(`
  cells with a source     ${totals.cells}
    already clean         ${totals.alreadyClean}
    cleanup proposed      ${totals.changed}  (high ${totals.high}, medium ${totals.medium}, low ${totals.low})
    still needs manual    ${totals.needsManual}
`);

// ---------------------------------------------------------------------------
// HTML output
// ---------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

const confBadge = (c) => `<span class="badge ${c}">${c}</span>`;

let html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Source review — Moto-Taxi Regulation Atlas</title>
<style>
  :root {
    --ground:#F4F2ED; --ink:#24211C; --ink-soft:#6B655B; --ink-faint:#9A9388;
    --rule:#D8D3CA; --accent:#B4552F; --good:#2B5D3E; --warn:#C98A2B; --bad:#9E3232;
    --serif:Georgia,serif; --mono:ui-monospace,'SF Mono','Cascadia Mono',Consolas,monospace;
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--ground); color:var(--ink); font-family:var(--mono); font-size:12.5px; line-height:1.5; }
  header { position:sticky; top:0; padding:18px 26px; background:var(--ground); border-bottom:1px solid var(--rule); z-index:10; }
  h1 { font-family:var(--serif); font-size:22px; margin:0 0 6px; }
  .sub { color:var(--ink-soft); font-size:11.5px; }
  .stats { margin-top:12px; display:flex; gap:16px; flex-wrap:wrap; font-size:11px; color:var(--ink-soft); }
  .stats strong { color:var(--ink); font-variant-numeric:tabular-nums; }
  .filters { margin-top:14px; display:flex; gap:8px; flex-wrap:wrap; }
  .filters button {
    font-family:var(--mono); font-size:10.5px; letter-spacing:0.07em; text-transform:uppercase;
    padding:6px 11px; background:transparent; color:var(--ink-soft);
    border:1px solid var(--rule); border-radius:3px; cursor:pointer;
  }
  .filters button:hover { background:#fff; }
  .filters button.on { background:var(--ink); color:var(--ground); border-color:var(--ink); }
  main { max-width:1400px; margin:0 auto; padding:22px 26px 80px; }

  .country-block { margin-bottom:34px; }
  .country-block > h2 {
    font-family:var(--serif); font-size:18px; font-weight:700; margin:0 0 12px;
    padding-bottom:6px; border-bottom:1px solid var(--rule);
  }

  .cell {
    display:grid; grid-template-columns: 220px 1fr 1fr 100px; gap:12px;
    padding:12px 0; border-bottom:1px solid var(--rule);
    align-items:flex-start;
  }
  .cell.unchanged { opacity:.5; }
  .ind { font-size:11.5px; color:var(--ink-soft); }

  .col { min-width:0; }
  .col h4 { font-size:9.5px; letter-spacing:0.09em; text-transform:uppercase; color:var(--ink-faint); margin:0 0 4px; font-weight:400; }
  .col pre {
    margin:0; padding:8px 10px; font-family:var(--mono); font-size:11px;
    background:#fff; border:1px solid var(--rule); border-radius:3px;
    white-space:pre-wrap; word-break:break-word; max-height:200px; overflow:auto;
  }
  .col.proposed pre { background:#F8F5EE; border-color:var(--ink-faint); }

  .actions { display:flex; flex-direction:column; gap:6px; align-items:flex-end; }
  .actions button {
    font-family:var(--mono); font-size:10px; letter-spacing:0.07em; text-transform:uppercase;
    padding:7px 12px; background:var(--ink); color:var(--ground); border:none; border-radius:3px; cursor:pointer;
    width:96px;
  }
  .actions button:hover { background:var(--accent); }
  .actions button.done { background:var(--good); }
  .actions button.done::before { content:'✓ '; }
  .actions .badge {
    font-size:9px; letter-spacing:0.07em; text-transform:uppercase; padding:3px 6px; border-radius:2px;
    border:1px solid var(--rule); color:var(--ink-soft); background:#fff;
  }
  .actions .badge.high { color:var(--good); border-color:var(--good); }
  .actions .badge.medium { color:var(--warn); border-color:var(--warn); }
  .actions .badge.low { color:var(--bad); border-color:var(--bad); }
  .actions .badge.unknown { color:var(--ink-faint); }

  .notes { grid-column: 2 / -2; margin-top:6px; }
  .notes .n { font-size:10.5px; color:var(--ink-soft); font-style:italic; }
  .notes .n + .n { margin-top:2px; }

  .help {
    margin:8px 0 20px; padding:12px 14px; background:#FFF8E6; border-left:3px solid var(--warn);
    border-radius:3px; font-size:11px; color:var(--ink-soft); line-height:1.6;
  }

  .cell[data-hide="1"] { display:none; }
</style>
</head>
<body>

<header>
  <h1>Source review — Moto-Taxi Regulation Atlas</h1>
  <div class="sub">Suggestions only — nothing has been written to the sheet. Generated ${new Date().toISOString().slice(0,16).replace('T', ' ')} UTC.</div>
  <div class="stats">
    <span><strong>${totals.cells}</strong> source cells</span>
    <span><strong>${totals.alreadyClean}</strong> already clean</span>
    <span><strong>${totals.changed}</strong> cleanup proposed
      (<strong>${totals.high}</strong> high · <strong>${totals.medium}</strong> medium · <strong>${totals.low}</strong> low)</span>
    <span><strong>${totals.needsManual}</strong> still need manual work</span>
  </div>
  <div class="filters">
    <button class="on" data-filter="all">All</button>
    <button data-filter="changed">Only changes</button>
    <button data-filter="high">High confidence</button>
    <button data-filter="medium">Medium</button>
    <button data-filter="low">Low</button>
    <button data-filter="manual">Needs manual work</button>
  </div>
</header>

<main>
  <div class="help">
    <strong>To paste into Google Sheets:</strong> click <em>Copy</em>, switch to the sheet, click the target cell,
    press <kbd>F2</kbd> (or double-click) to enter edit mode, paste, <kbd>Enter</kbd>. Double-clicking first is what preserves the line breaks
    inside a single cell.
  </div>
`;

for (const g of rows) {
  html += `<section class="country-block" data-country="${esc(g.iso3)}">
    <h2>${esc(g.country)} <span style="font-family:var(--mono);font-size:11px;color:var(--ink-faint);font-weight:400">— ${g.cells.length} source cell${g.cells.length === 1 ? '' : 's'}</span></h2>`;

  for (const c of g.cells) {
    const conf = c.review.changes.some((x) => x.kind === 'needs-manual') ? 'manual' : c.review.confidence;
    const changed = !c.review.unchanged;
    html += `<div class="cell${changed ? '' : ' unchanged'}"
      data-changed="${changed ? 1 : 0}" data-conf="${conf}">
      <div class="ind">${esc(c.indicator)}</div>
      <div class="col current">
        <h4>Current</h4>
        <pre>${esc(c.raw)}</pre>
      </div>
      <div class="col proposed">
        <h4>${changed ? 'Proposed' : 'No change'}</h4>
        <pre>${esc(c.review.proposed)}</pre>
      </div>
      <div class="actions">
        ${confBadge(conf === 'manual' ? 'unknown' : conf)}
        <button ${changed ? '' : 'disabled style="opacity:.4;cursor:default"'} data-copy="${esc(c.review.proposed)}">Copy</button>
      </div>
      ${c.review.changes.length ? `<div class="notes">
        ${c.review.changes.map((x) => `<div class="n">· ${esc(x.note)}</div>`).join('')}
      </div>` : ''}
    </div>`;
  }
  html += `</section>`;
}

html += `
<script>
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-copy]');
    if (b) {
      try {
        await navigator.clipboard.writeText(b.dataset.copy);
        b.textContent = 'Copied';
        b.classList.add('done');
        setTimeout(() => { b.textContent = 'Copy'; b.classList.remove('done'); }, 2200);
      } catch (err) {
        alert('Copy failed: ' + err.message);
      }
      return;
    }
    const f = e.target.closest('button[data-filter]');
    if (f) {
      document.querySelectorAll('.filters button').forEach((x) => x.classList.remove('on'));
      f.classList.add('on');
      const mode = f.dataset.filter;
      for (const cell of document.querySelectorAll('.cell')) {
        const changed = cell.dataset.changed === '1';
        const conf = cell.dataset.conf;
        let show = true;
        if (mode === 'changed') show = changed;
        else if (mode === 'high' || mode === 'medium' || mode === 'low') show = changed && conf === mode;
        else if (mode === 'manual') show = conf === 'manual';
        cell.dataset.hide = show ? '0' : '1';
      }
      // Hide empty country blocks.
      for (const sec of document.querySelectorAll('.country-block')) {
        const anyVisible = [...sec.querySelectorAll('.cell')].some((c) => c.dataset.hide !== '1');
        sec.style.display = anyVisible ? '' : 'none';
      }
    }
  });
</script>
</body></html>
`;

const outPath = join(ROOT, 'source-review.html');
writeFileSync(outPath, html);
console.log(`  wrote  ${outPath}`);
console.log(`         open it in a browser — nothing is written to the sheet.\n`);
