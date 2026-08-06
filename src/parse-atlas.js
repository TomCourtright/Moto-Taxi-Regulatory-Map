// Shared parser for the GNPT Global Moto-Taxi Regulation Atlas.
// Used by BOTH scripts/build-data.mjs (Node, build time) and the browser (live fetch),
// so the two data paths cannot drift. See PRD.md §3.
//
// Input:  the raw CSV text of the published Google Sheet.
// Output: { indicators, groups, countries, meta } — see buildAtlas() at the bottom.

// ---------------------------------------------------------------------------
// RFC 4180 CSV parser. The sheet's Notes and Source cells contain embedded
// newlines, commas, smart quotes and doubled quotes, so split(',') is not an
// option here. PRD.md §2.3.2.
// ---------------------------------------------------------------------------

export function parseCSV(text) {
  // Strip BOM and normalise line endings before we start.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }  // escaped quote
        else inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') { inQuotes = true; }
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else { field += c; }
  }
  // Flush whatever is left; guard against a trailing newline producing a ghost row.
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  return rows;
}

// ---------------------------------------------------------------------------
// Vocabulary. The sheet keeps its research shorthand; the published labels are
// applied here at render time. The sheet is never edited to suit the website.
// PRD.md §4.
// ---------------------------------------------------------------------------

// Legislation status (column D) — drives the map colour. PRD.md §4.2
//
// Palette logic: hue encodes WHETHER the sector is regulated, lightness encodes
// AT WHAT LEVEL. So the two regulated categories are one teal hue at two
// lightnesses — they are the same phenomenon at different scales, and reading
// them as a pair is the point. Prohibited is categorically different, so it
// keeps its own hue. Unregulated is a warm taupe, deliberately warmer and
// darker than the cool, pale "not researched" land, so the two never read as
// the same grey.
export const STATUS = {
  regulated:   { key: 'regulated',   label: 'Nationally Regulated', color: '#2B5D3E' },
  local:       { key: 'local',       label: 'Locally Regulated',    color: '#8CB79A' },
  prohibited:  { key: 'prohibited',  label: 'Prohibited',           color: '#9E3232' },
  unregulated: { key: 'unregulated', label: 'Unregulated',          color: '#B3A695' },
  nodata:      { key: 'nodata',      label: 'No data',              color: '#E3DFD7' },
};

const STATUS_FROM_SHEET = {
  'present': 'regulated',
  'fragmented': 'local',
  'mixed status': 'local',
  "it's complicated": 'local',
  'prohibited': 'prohibited',
  'not present': 'unregulated',
  '': 'nodata',
  'no data': 'nodata',
};

// Indicator values (columns E onward). PRD.md §4.3
export const VALUE = {
  required:    { key: 'required',    label: 'Required',        color: '#2B5D3E' },
  notrequired: { key: 'notrequired', label: 'Not required',    color: '#B3A695' },
  mixed:       { key: 'mixed',       label: 'Mixed / unclear', color: '#C98A2B' },
  nodata:      { key: 'nodata',      label: 'No data',         color: '#E3DFD7' },
};

const VALUE_FROM_SHEET = {
  'present': 'required',
  'not present': 'notrequired',
  'mixed status': 'mixed',
  "it's complicated": 'mixed',   // synonym — normalised. PRD.md §2.3.4
  'fragmented': 'mixed',
  'no data': 'nodata',
  '': 'nodata',
};

// Enforcement is displayed but not analysed in v1 — data too sparse. PRD.md §7.1
export const ENFORCEMENT = {
  'very commonly': { label: 'Very commonly', rank: 4 },
  'commonly':      { label: 'Commonly',      rank: 3 },
  'sometimes':     { label: 'Sometimes',     rank: 2 },
  'rarely / never': { label: 'Rarely / never', rank: 1 },
  'rarely/never':  { label: 'Rarely / never', rank: 1 },
  'unknown':       { label: 'Unknown',       rank: 0 },
};

const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
const key = (s) => norm(s).toLowerCase();

export function statusOf(raw) {
  return STATUS[STATUS_FROM_SHEET[key(raw)] ?? 'nodata'];
}

export function valueOf(raw) {
  return VALUE[VALUE_FROM_SHEET[key(raw)] ?? 'nodata'];
}

export function enforcementOf(raw) {
  return ENFORCEMENT[key(raw)] ?? null;
}

export function slugify(s) {
  return norm(s).toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Sheet structure. Rather than hardcoding column offsets, we derive them from
// the two header rows so that adding an indicator to the sheet does not require
// a code change.
//
//   row 0 : group headers, sparse (a label appears once, above its first column)
//   row 1 : indicator names, one per column
//   col 0 : country name — present only on the first row of each 4-row block
//   col 1 : country-level summary sentence
//   col 2 : row label — Written | Enforced | Source | Notes
//   col 3+: indicators, the first of which is the legislation status
// ---------------------------------------------------------------------------

const FIRST_INDICATOR_COL = 3;
const ROW_LABELS = ['Written', 'Enforced', 'Source', 'Notes'];

function readSchema(rows) {
  const groupRow = rows[0] || [];
  const nameRow = rows[1] || [];

  const indicators = [];
  let currentGroup = 'Other';

  for (let c = FIRST_INDICATOR_COL; c < nameRow.length; c++) {
    // Group labels forward-fill: a label sits above the first column of its group.
    if (norm(groupRow[c])) currentGroup = norm(groupRow[c]);

    const name = norm(nameRow[c]);
    if (!name) continue;  // trailing spacer columns, e.g. the empty "Compliance Data"

    indicators.push({
      col: c,
      name,
      slug: slugify(name),
      group: currentGroup,
      isLegislation: c === FIRST_INDICATOR_COL,
    });
  }

  const groups = [];
  for (const ind of indicators) {
    if (!groups.includes(ind.group)) groups.push(ind.group);
  }

  return { indicators, groups };
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

export function buildAtlas(csvText, { resolveISO3 = () => null } = {}) {
  const rows = parseCSV(csvText);
  const { indicators, groups } = readSchema(rows);

  const countries = [];
  const warnings = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    // Drop nameless blocks — the sheet has a trailing empty 4-row block that a
    // naive parser attributes to the previous country. PRD.md §2.3.1
    if (!current.name) return;
    countries.push(current);
  };

  for (let r = 2; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    const name = norm(row[0]);
    const label = norm(row[2]);

    if (name) {
      flush();
      current = {
        name,
        slug: slugify(name),
        iso3: resolveISO3(name),
        summary: norm(row[1]),
        level: 'national',           // subnational support is additive. PRD.md §7.2
        status: null,
        indicators: {},
      };
      if (!current.iso3) warnings.push(`Unresolved ISO3: "${name}"`);
    }

    if (!current) continue;
    if (!ROW_LABELS.includes(label)) continue;

    for (const ind of indicators) {
      const raw = norm(row[ind.col]);
      if (!raw) continue;

      const slot = (current.indicators[ind.slug] ||= {
        slug: ind.slug, name: ind.name, group: ind.group,
      });

      if (label === 'Written') slot.written = raw;
      else if (label === 'Enforced') slot.enforced = raw;
      else if (label === 'Source') slot.source = raw;
      else if (label === 'Notes') slot.notes = raw;
    }
  }
  flush();

  // Derive per-country status and coverage tier. Tier is computed, never
  // hardcoded, so it improves automatically as the sheet is filled in. PRD.md §2.4
  const legislation = indicators.find((i) => i.isLegislation);

  for (const c of countries) {
    const leg = c.indicators[legislation.slug];
    c.status = statusOf(leg?.written).key;
    c.statusSource = leg?.source || '';
    c.statusNotes = leg?.notes || '';

    // Count indicators that carry a real written value, excluding legislation itself.
    let filled = 0;
    for (const ind of indicators) {
      if (ind.isLegislation) continue;
      const v = c.indicators[ind.slug];
      if (v && v.written) filled++;
    }
    c.filled = filled;
    c.tier = filled >= 25 ? 'full' : filled >= 10 ? 'partial' : 'status';
  }

  countries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    meta: {
      generated: new Date().toISOString(),
      countryCount: countries.length,
      indicatorCount: indicators.length,
      fullProfileCount: countries.filter((c) => c.tier === 'full').length,
      warnings,
    },
    groups,
    indicators: indicators.map(({ col, ...rest }) => rest),
    countries,
  };
}
