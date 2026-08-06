// Refresh the baked snapshot. PRD.md §3.
//
//   node scripts/build-data.mjs           fetch the live sheet
//   node scripts/build-data.mjs --static  use the local CSV instead
//
// Writes data/atlas.json and data/world.geo.json, then reports any country that
// failed to resolve to ISO3 or to map geometry. A country that cannot be drawn
// is a loud failure here, never a silent gap on the map.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildAtlas } from '../src/parse-atlas.js';
import { resolveISO3, ISO3_TO_NUM, SMALL_STATE_POINTS } from '../src/iso3.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const SHEET_CSV =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vQtzoKLQsRshikHltqLvDxYInnl0qyu-SyK00' +
  'eEaIQSl-xoDEwadn2TXIt3QT7niB2tKvOs-KGPye_g/pub?gid=1544705327&single=true&output=csv';

const STATIC_CSV = 'Regulations (Static - July 21).csv';

// ---------------------------------------------------------------------------
// TopoJSON → GeoJSON. Implemented here rather than pulled from npm: it is ~40
// lines and keeps the project dependency-free.
// ---------------------------------------------------------------------------

function decodeTopology(topo) {
  const { scale, translate } = topo.transform;

  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [
        +(x * scale[0] + translate[0]).toFixed(2),
        +(y * scale[1] + translate[1]).toFixed(2),
      ];
    });
  });

  // A negative index means "use arc ~i, reversed". Consecutive arcs share an
  // endpoint, so drop the duplicate when stitching.
  const ring = (indices) => {
    const out = [];
    for (const i of indices) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
  };

  return topo.objects.countries.geometries.map((g) => ({
    type: 'Feature',
    id: String(g.id),
    properties: { name: g.properties?.name ?? '' },
    geometry:
      g.type === 'Polygon'
        ? { type: 'Polygon', coordinates: g.arcs.map(ring) }
        : g.type === 'MultiPolygon'
        ? { type: 'MultiPolygon', coordinates: g.arcs.map((p) => p.map(ring)) }
        : null,
  })).filter((f) => f.geometry);
}

// ---------------------------------------------------------------------------

const useStatic = process.argv.includes('--static');
let csv, provenance;

if (useStatic) {
  csv = readFileSync(join(ROOT, STATIC_CSV), 'utf8');
  provenance = `static file — ${STATIC_CSV}`;
} else {
  process.stdout.write('Fetching live sheet… ');
  try {
    const res = await fetch(SHEET_CSV, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    csv = await res.text();
    provenance = 'live Google Sheet';
    console.log(`ok (${csv.length.toLocaleString()} bytes)`);
  } catch (err) {
    console.log(`FAILED (${err.message}) — falling back to static CSV`);
    csv = readFileSync(join(ROOT, STATIC_CSV), 'utf8');
    provenance = `static file (live fetch failed) — ${STATIC_CSV}`;
  }
}

const atlas = buildAtlas(csv, { resolveISO3 });
atlas.meta.provenance = provenance;

// --- Geometry -------------------------------------------------------------

const topo = JSON.parse(readFileSync(join(ROOT, 'data/world-110m.topo.json'), 'utf8'));
const features = decodeTopology(topo);
const geomIds = new Set(features.map((f) => f.id));

writeFileSync(
  join(ROOT, 'data/world.geo.json'),
  JSON.stringify({ type: 'FeatureCollection', features }),
);

// --- Verification ---------------------------------------------------------

const unresolved = atlas.countries.filter((c) => !c.iso3);
const noGeometry = atlas.countries.filter(
  (c) => c.iso3 && !geomIds.has(ISO3_TO_NUM[c.iso3]) && !SMALL_STATE_POINTS[c.iso3],
);
const asPoints = atlas.countries.filter(
  (c) => c.iso3 && !geomIds.has(ISO3_TO_NUM[c.iso3]) && SMALL_STATE_POINTS[c.iso3],
);

// Attach how each country should be drawn, so the renderer never has to guess.
for (const c of atlas.countries) {
  c.num = ISO3_TO_NUM[c.iso3] || null;
  c.render = !c.iso3 ? 'none' : geomIds.has(c.num) ? 'shape' : SMALL_STATE_POINTS[c.iso3] ? 'point' : 'none';
}

writeFileSync(join(ROOT, 'data/atlas.json'), JSON.stringify(atlas));

// --- Report ---------------------------------------------------------------

const tally = (k) => atlas.countries.filter((c) => c.status === k).length;

console.log(`
  source        ${provenance}
  countries     ${atlas.meta.countryCount}
  indicators    ${atlas.meta.indicatorCount}
  geometry      ${features.length} features

  Nationally Regulated  ${tally('regulated')}
  Locally Regulated     ${tally('local')}
  Prohibited            ${tally('prohibited')}
  Unregulated           ${tally('unregulated')}
  No data               ${tally('nodata')}

  full profile  ${atlas.meta.fullProfileCount}
  partial       ${atlas.countries.filter((c) => c.tier === 'partial').length}
  status only   ${atlas.countries.filter((c) => c.tier === 'status').length}

  drawn as point marker: ${asPoints.map((c) => c.name).join(', ') || 'none'}`);

if (unresolved.length) {
  console.error(`\n  ✗ ${unresolved.length} country/countries failed ISO3 resolution:`);
  for (const c of unresolved) console.error(`      "${c.name}"  — add to NAME_TO_ISO3 in src/iso3.js`);
}
if (noGeometry.length) {
  console.error(`\n  ✗ ${noGeometry.length} country/countries have no geometry and no point fallback:`);
  for (const c of noGeometry) console.error(`      ${c.name} (${c.iso3}/${ISO3_TO_NUM[c.iso3]})`);
}

if (unresolved.length || noGeometry.length) {
  console.error('\n  Build FAILED verification — every country must be drawable.\n');
  process.exit(1);
}
console.log('\n  ✓ all countries resolved and drawable\n');
