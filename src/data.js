// Shared atlas loading. PRD.md §3.
//
// Live sheet first, baked snapshot as fallback. Every page uses this, so the
// map and the comparison view can never disagree about what the data says.

import { buildAtlas } from './parse-atlas.js';
import { resolveISO3 } from './iso3.js';
import { CONFIG } from '../config.js';

// Every fetch in the app goes through here so none of them can hang forever.
// A dead or slow host must fail fast into a visible error, not an indefinite
// "Loading…". PRD.md §3.
export async function fetchWithTimeout(url, ms, opts = {}) {
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

export async function loadAtlas() {
  try {
    const res = await fetchWithTimeout(CONFIG.sheetCSV, CONFIG.liveTimeoutMs);
    const atlas = buildAtlas(await res.text(), { resolveISO3 });

    // A mid-edit sheet must not be allowed to blank the atlas.
    if (atlas.countries.length < CONFIG.minCountries) {
      throw new Error(`only ${atlas.countries.length} countries parsed`);
    }
    return { atlas, live: true, note: null };
  } catch (err) {
    // Fall back to the baked snapshot — but bound this too, so a dead host
    // surfaces an error in a couple of seconds rather than stalling on TCP.
    const res = await fetchWithTimeout('data/atlas.json', CONFIG.localTimeoutMs);
    return { atlas: await res.json(), live: false, note: err.message };
  }
}

// Shared header treatment for the live/snapshot indicator. Imports i18n
// lazily so a locale that hasn't loaded yet falls back to English.
export function paintProvenance(el, loaded) {
  const { t } = i18nOrEnglish();
  el.className = 'provenance ' + (loaded.live ? 'live' : 'snapshot');
  const stamp = new Date(loaded.atlas.meta.generated).toISOString().slice(0, 10);
  const label = loaded.live ? t('ui', 'prov.live') : t('ui', 'prov.snapshot');
  el.innerHTML = `<span class="pip"></span>${label} · ${stamp}`;
  el.title = loaded.live
    ? t('ui', 'prov.live.title')
    : t('ui', 'prov.snapshot.title') + (loaded.note ? ` (${loaded.note})` : '');
}

// Cheap indirection so data.js doesn't hard-import i18n.js and create a cycle.
function i18nOrEnglish() {
  // At this point i18n is imported by whichever page module also imports us.
  // If it hasn't run yet, fall through to English literals.
  return typeof window !== 'undefined' && window.__atlasI18n
    ? window.__atlasI18n
    : { t: (_, k) => ({
        'prov.live': 'Live sheet',
        'prov.snapshot': 'Snapshot',
        'prov.live.title': 'Loaded directly from the published Google Sheet.',
        'prov.snapshot.title': 'Live sheet unavailable; showing the last baked snapshot.',
      }[k] ?? k) };
}

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// Source parsing lives in sources.js — re-exported here so pages have a single
// import for everything data-related.
export { renderSources, parseSources, sourceToText } from './sources.js';
