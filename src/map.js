// Status map + country drawer. PRD.md §5.1, §5.2, §5.3.

import { STATUS, VALUE, valueOf, enforcementOf } from './parse-atlas.js';
import { SMALL_STATE_POINTS, ISO3_TO_NUM } from './iso3.js';
import { loadAtlas, fetchWithTimeout, paintProvenance, esc, renderSources } from './data.js';
import { initI18n, t, countryName, hasSummary, summaryOf, statusLabel, valueLabel, groupName, indicatorName, currentLang } from './i18n.js';
import { CONFIG } from '../config.js';

const $ = (s) => document.querySelector(s);
const svgNS = 'http://www.w3.org/2000/svg';

const state = {
  atlas: null,
  byNum: new Map(),      // ISO-numeric → country record
  documents: {},         // ISO3 → [document] (PRD §6); empty until loaded
  filter: null,          // status key, or null for all
  indicator: null,       // indicator slug, or null for legislation status
  selected: null,
  openDetail: null,
  view: { x: 0, y: 0, k: 1 },
};

// ---------------------------------------------------------------------------
// Equal Earth projection (Šavrič, Patterson & Jenny, 2018).
//
// Equal-area, so a country's area on screen is proportional to its true area —
// which matters for an atlas whose subject is concentrated in equatorial Africa
// and South-East Asia. Mercator-family projections inflate high latitudes and
// would shrink exactly the countries this atlas is about. Equal Earth keeps that
// honesty while still looking like a world map.
//
// Implemented directly so the project stays dependency-free.
// ---------------------------------------------------------------------------

const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2;

function project([lon, lat]) {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;

  const t = Math.asin(M * Math.sin(p));
  const t2 = t * t, t6 = t2 * t2 * t2, t8 = t6 * t2;

  const x = (l * Math.cos(t)) / (M * (A1 + 3 * A2 * t2 + 7 * A3 * t6 + 9 * A4 * t8));
  const y = t * (A1 + A2 * t2 + A3 * t6 + A4 * t8);

  return [x * 100, -y * 100];
}

function pathFor(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  let d = '';
  for (const poly of polys) {
    for (const ring of poly) {
      // Skip degenerate rings that survive simplification.
      if (ring.length < 3) continue;

      let open = false;
      for (let i = 0; i < ring.length; i++) {
        // Russia and Fiji wrap the antimeridian: consecutive points jump from
        // +180 to -180, and drawing straight between them sweeps a band across
        // the whole map. Break the subpath at the seam instead.
        if (i > 0 && Math.abs(ring[i][0] - ring[i - 1][0]) > 180) {
          d += 'Z';
          open = false;
        }
        const [x, y] = project(ring[i]);
        d += (open ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
        open = true;
      }
      d += 'Z';
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

function colorFor(country) {
  if (!country) return 'url(#not-researched)';

  if (state.indicator) {
    // Indicator mode is restricted to countries with real indicator research;
    // everything else reads as No data rather than as a false negative.
    if (country.tier === 'status') return VALUE.nodata.color;
    return valueOf(country.indicators[state.indicator]?.written).color;
  }
  return STATUS[country.status].color;
}

function dimmed(country) {
  if (!state.filter) return false;
  return !country || country.status !== state.filter;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

let gRoot;

function renderMap(world) {
  const svg = $('#map');
  svg.innerHTML = '';

  // Countries outside the dataset are hatched rather than given another grey.
  // Texture, not hue, distinguishes "not researched" from "researched, and the
  // answer is no law" — otherwise the two read as the same thing.
  svg.insertAdjacentHTML('afterbegin', `
    <defs>
      <pattern id="not-researched" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4" height="4" fill="var(--land)"></rect>
        <line x1="0" y1="0" x2="0" y2="4" stroke="var(--land-hatch)" stroke-width="1.1"></line>
      </pattern>
    </defs>`);

  gRoot = document.createElementNS(svgNS, 'g');
  svg.appendChild(gRoot);

  const bounds = { minX: 1e9, minY: 1e9, maxX: -1e9, maxY: -1e9 };

  for (const f of world.features) {
    // Antarctica is dropped: it carries no data and eats a third of the frame.
    if (f.id === '010') continue;

    const country = state.byNum.get(f.id);
    const p = document.createElementNS(svgNS, 'path');
    const d = pathFor(f.geometry);
    p.setAttribute('d', d);
    p.setAttribute('class', 'country' + (country ? ' interactive' : ''));
    p.dataset.num = f.id;
    if (country) p.dataset.iso3 = country.iso3;
    gRoot.appendChild(p);

    // Bounds from the drawn paths, so the frame fits what is actually shown.
    for (const poly of (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)) {
      for (const ring of poly) for (const c of ring) {
        const [x, y] = project(c);
        if (x < bounds.minX) bounds.minX = x;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (y > bounds.maxY) bounds.maxY = y;
      }
    }
  }

  // Small states with no polygon at 110m, drawn as markers so they are present
  // and clickable rather than silently missing. PRD.md §11
  for (const c of state.atlas.countries) {
    if (c.render !== 'point') continue;
    const [x, y] = project(SMALL_STATE_POINTS[c.iso3]);
    const circ = document.createElementNS(svgNS, 'circle');
    circ.setAttribute('cx', x); circ.setAttribute('cy', y); circ.setAttribute('r', 1.6);
    circ.setAttribute('class', 'point-marker');
    circ.dataset.iso3 = c.iso3;
    gRoot.appendChild(circ);
  }

  const pad = 4;
  svg.setAttribute('viewBox',
    `${bounds.minX - pad} ${bounds.minY - pad} ${bounds.maxX - bounds.minX + pad * 2} ${bounds.maxY - bounds.minY + pad * 2}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  paint();
}

function paint() {
  let selectedEl = null;
  for (const el of gRoot.querySelectorAll('.country')) {
    const c = state.byNum.get(el.dataset.num);
    el.style.fill = colorFor(c);
    el.classList.toggle('dimmed', !!c && dimmed(c));
    const isSel = !!c && c.iso3 === state.selected;
    el.classList.toggle('selected', isSel);
    if (isSel) selectedEl = el;
  }
  for (const el of gRoot.querySelectorAll('.point-marker')) {
    const c = state.atlas.countries.find((x) => x.iso3 === el.dataset.iso3);
    el.style.fill = colorFor(c);
    el.classList.toggle('dimmed', dimmed(c));
  }
  // SVG paints in DOM order — neighbours later in the tree paint their white
  // strokes over the selected country's dark stroke on shared borders. Move
  // the selected element to the end of the group so it paints last.
  if (selectedEl) gRoot.appendChild(selectedEl);

  $('#scope-note').hidden = !state.indicator;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function renderLegend() {
  const el = $('#legend');
  el.innerHTML = '';
  for (const key of ['regulated', 'local', 'prohibited', 'unregulated']) {
    const s = STATUS[key];
    const n = state.atlas.countries.filter((c) => c.status === key).length;
    const b = document.createElement('button');
    b.setAttribute('aria-pressed', String(state.filter === key));
    b.innerHTML = `<span class="sw" style="background:${s.color}"></span>${esc(statusLabel(key))}<span class="count">${n}</span>`;
    b.onclick = () => { state.filter = state.filter === key ? null : key; renderLegend(); paint(); };
    el.appendChild(b);
  }

  // The hatch needs explaining, or users will read it as a fifth status.
  const note = document.createElement('span');
  note.className = 'legend-note';
  note.innerHTML = `<span class="sw-hatch"></span>${esc(t('ui', 'legend.notResearched'))}`;
  note.title = t('ui', 'legend.notResearched.title');
  el.appendChild(note);
}

function renderIndicatorPicker() {
  const sel = $('#indicator-select');
  sel.innerHTML = `<option value="">${esc(t('ui', 'map.control.legislationStatus'))}</option>`;
  // Sort indicators by their localised name so the picker reads alphabetically
  // in the current language rather than the sheet's English ordering.
  const sorted = state.atlas.indicators
    .filter((i) => !i.isLegislation)
    .map((i) => ({ ...i, display: indicatorName(i.slug) }))
    .sort((a, b) => a.display.localeCompare(b.display));
  for (const ind of sorted) {
    sel.innerHTML += `<option value="${ind.slug}">${esc(ind.display)}</option>`;
  }
  sel.onchange = () => {
    state.indicator = sel.value || null;
    paint();
    if (state.selected) openCountry(state.selected);
  };
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

// Used for prose fields (summaries, notes), where a bare URL may appear inline.
// Structured Source fields go through renderSources() in data.js instead.
const linkify = (text) =>
  esc(text).replace(/https?:\/\/[^\s;,)]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

const KB = 1024;
function fileSize(bytes) {
  if (!bytes) return '';
  return bytes >= KB * KB ? `${(bytes / (KB * KB)).toFixed(1)} MB` : `${Math.round(bytes / KB)} KB`;
}

// Documents section — PRD.md §6. Hidden entirely when a country has none, so the
// gap is not advertised on every visit.
//
// Two link targets, and the difference is stated rather than implied:
//   local copy  → our own file, durable
//   origin only → the issuing site, which may move or disappear
function renderDocuments(iso3) {
  const docs = state.documents?.[iso3] ?? [];
  if (!docs.length) return '';

  const items = docs.map((d) => {
    const meta = [];
    if (d.kind) meta.push(esc(d.kind.toUpperCase()));
    if (d.pages) meta.push(esc(t('ui', 'documents.pages', { n: d.pages })));
    if (d.bytes) meta.push(esc(fileSize(d.bytes)));
    if (d.language) meta.push(esc(d.language.toUpperCase()));
    if (d.year) meta.push(esc(d.year));
    if (d.official) meta.push(`<span class="official">${esc(t('ui', 'documents.official'))}</span>`);
    if (d.scanned) meta.push(`<span class="scanned">${esc(t('ui', 'documents.scanned'))}</span>`);

    // The local copy is the primary link precisely because the origin may rot.
    const head = d.path
      ? `<a href="${esc(d.path)}" target="_blank" rel="noopener">${esc(d.title)}</a>`
      : d.originalUrl
        ? `<a href="${esc(d.originalUrl)}" target="_blank" rel="noopener">${esc(d.title)}</a>
           <span class="external" title="${esc(t('ui', 'documents.external.title'))}">${esc(t('ui', 'documents.external'))}</span>`
        : `<span class="no-link">${esc(d.title)}</span>`;

    // Keep the origin reachable even when we serve a copy — a regulator may need
    // to confirm the copy against the issuing authority.
    const origin = d.path && d.originalUrl
      ? `<a class="origin" href="${esc(d.originalUrl)}" target="_blank" rel="noopener"
            title="${esc(t('ui', 'documents.origin.title'))}">${esc(t('ui', 'documents.origin'))}${d.host ? ` · ${esc(d.host)}` : ''}</a>`
      : '';

    return `<li>${head}${meta.length ? ` <span class="meta">${meta.join(' · ')}</span>` : ''}${origin}</li>`;
  });

  return `<h3 class="sec">${esc(t('ui', 'drawer.sec.documents'))}</h3>
    <ul class="documents">${items.join('')}</ul>`;
}

function openCountry(iso3) {
  const c = state.atlas.countries.find((x) => x.iso3 === iso3);
  if (!c) return;

  state.selected = iso3;
  state.openDetail = null;
  location.hash = `#/country/${iso3.toLowerCase()}`;

  const status = STATUS[c.status];
  const tierKey = c.tier === 'full' ? 'drawer.badge.full'
    : c.tier === 'partial' ? 'drawer.badge.partial'
    : 'drawer.badge.status';

  $('#c-name').textContent = countryName(c.iso3);
  $('#c-badges').innerHTML =
    `<span class="pill status" style="background:${status.color}">${esc(statusLabel(c.status))}</span>` +
    `<span class="pill tier">${esc(t('ui', tierKey))}</span>`;

  const body = $('#drawer-body');
  let html = '';

  // Country summaries and legislation notes are editorial prose sourced from
  // the sheet's English column. If a translated summary exists, use it;
  // otherwise fall back to English WITH a visible marker — invisible fallback
  // in a policy document is a correctness problem (PRD.md §8).
  const nonEnglish = currentLang() !== 'en';
  const fallbackMark = nonEnglish ? ' class="summary i18n-missing" title="Untranslated — showing English"' : ' class="summary"';

  if (c.summary) {
    const localized = summaryOf(c.iso3);
    if (localized) html += `<blockquote class="summary">${linkify(localized)}</blockquote>`;
    else html += `<blockquote${fallbackMark}>${linkify(c.summary)}</blockquote>`;
  }
  if (c.statusNotes) {
    // Sheet-sourced prose; always English. Marked as fallback in non-English UI.
    html += nonEnglish
      ? `<p class="summary i18n-missing" style="font-size:13px;color:var(--ink-soft)" title="Untranslated — showing English">${linkify(c.statusNotes)}</p>`
      : `<p class="summary" style="font-size:13px;color:var(--ink-soft)">${linkify(c.statusNotes)}</p>`;
  }

  if (c.statusSource) {
    html += `<h3 class="sec">${esc(t('ui', 'drawer.sec.source'))}</h3><div class="source">${renderSources(c.statusSource)}</div>`;
  }

  // Requirements, grouped as in the sheet.
  const withData = state.atlas.indicators.filter(
    (i) => !i.isLegislation && c.indicators[i.slug]?.written,
  );

  if (withData.length) {
    const total = state.atlas.indicators.length - 1;
    html += `<h3 class="sec">${esc(t('ui', 'drawer.sec.requirements'))}
      <span style="text-transform:none;letter-spacing:0">${esc(t('ui', 'drawer.requirementsCount', { n: withData.length, total }))}</span></h3>`;
    for (const group of state.atlas.groups) {
      const inGroup = withData.filter((i) => i.group === group);
      if (!inGroup.length) continue;
      html += `<div class="group"><h4>${esc(groupName(group))}</h4><div class="chips">`;
      for (const ind of inGroup) {
        const rec = c.indicators[ind.slug];
        const v = valueOf(rec.written);
        const hasDetail = !!(rec.notes || rec.source || rec.enforced);
        html += `<button class="chip${hasDetail ? '' : ' bare'}" data-ind="${ind.slug}"${hasDetail ? '' : ' disabled'}>
          <span class="sw" style="background:${v.color}"></span>
          <span>${esc(indicatorName(ind.slug))}</span>
          ${hasDetail ? '<span class="has-detail">+</span>' : ''}
        </button>`;
        html += `<div class="detail" id="d-${ind.slug}" hidden>
          <div class="blk"><span class="lbl">${esc(t('ui', 'drawer.detail.status'))}</span><p>${esc(valueLabel(v.key))}</p></div>
          ${rec.notes ? `<div class="blk"><span class="lbl">${esc(t('ui', 'drawer.detail.notes'))}</span><p>${linkify(rec.notes)}</p></div>` : ''}
          ${rec.source ? `<div class="blk"><span class="lbl">${esc(t('ui', 'drawer.detail.source'))}</span>${renderSources(rec.source)}</div>` : ''}
          ${rec.enforced ? `<div class="blk"><span class="lbl">${esc(t('ui', 'drawer.detail.enforcement'))}</span><p>${esc(enforcementOf(rec.enforced)?.label ?? rec.enforced)}</p>
             <p class="enforce-note">${esc(t('ui', 'drawer.enforcementNote'))}</p></div>` : ''}
        </div>`;
      }
      html += `</div></div>`;
    }
  }
  // Countries with no indicator research simply have no Requirements section.
  // An empty-state message would draw attention to the gap on every visit.

  html += renderDocuments(c.iso3);

  html += `<div class="cite">
    <button id="copy-cite">${esc(t('ui', 'drawer.copyCitation'))}</button>
  </div>`;

  body.innerHTML = html;
  body.scrollTop = 0;

  for (const chip of body.querySelectorAll('.chip:not(.bare)')) {
    chip.onclick = () => {
      const d = body.querySelector(`#d-${CSS.escape(chip.dataset.ind)}`);
      const wasOpen = !d.hidden;
      for (const other of body.querySelectorAll('.detail')) other.hidden = true;
      d.hidden = wasOpen;
    };
  }

  $('#copy-cite').onclick = (e) => {
    const cite = t('ui', 'drawer.citation.template', {
      year: new Date().getFullYear(),
      country: countryName(c.iso3),
      date: new Date().toISOString().slice(0, 10),
      url: location.href,
    });
    navigator.clipboard?.writeText(cite);
    e.target.textContent = t('ui', 'drawer.copyCitation.done');
    setTimeout(() => { e.target.textContent = t('ui', 'drawer.copyCitation'); }, 1600);
  };

  $('#drawer').classList.add('open');
  zoomToCountry(c);
  paint();
}

function closeDrawer() {
  state.selected = null;
  $('#drawer').classList.remove('open');
  if (location.hash.startsWith('#/country/')) location.hash = '#/map';
  paint();
}

// ---------------------------------------------------------------------------
// Interaction
// ---------------------------------------------------------------------------

function applyView() {
  gRoot.setAttribute('transform', `translate(${state.view.x} ${state.view.y}) scale(${state.view.k})`);
}

// Auto-zoom to a country so its neighbours are easy to click. The frame is
// scaled to the country's own size — Panama gets a Central-America view;
// Brazil barely zooms because it already fills its region. Only fires when
// the current zoom is 1 (a manually-zoomed user is not overridden).
function zoomToCountry(c) {
  if (!c) return;

  const el = gRoot.querySelector(`[data-iso3="${c.iso3}"]`);
  if (!el) return;

  let bbox;
  try { bbox = el.getBBox(); } catch { return; }
  if (!bbox || (bbox.width === 0 && bbox.height === 0)) return;

  const cx = bbox.x + bbox.width / 2;
  const cy = bbox.y + bbox.height / 2;
  const extent = Math.max(bbox.width, bbox.height, 3);   // 3 unit floor for point-markers

  // Target frame: a few times the country's extent so neighbours are visible.
  // Clamped so the zoom is meaningful even for tiny countries but never runs
  // past the map edges for huge ones.
  const targetExtent = Math.max(extent * 5, 35);
  const svg = $('#map');
  const vb = svg.viewBox.baseVal;
  const worldExtent = Math.max(vb.width, vb.height);
  const k = Math.min(6, worldExtent / targetExtent);

  // Transform maps (px,py) → (px*k + tx, py*k + ty). Solve for the offset that
  // puts the country's centroid at the viewBox centre.
  const tx = vb.x + vb.width / 2 - cx * k;
  const ty = vb.y + vb.height / 2 - cy * k;

  state.view = { x: tx, y: ty, k };
  gRoot.classList.add('smooth');
  applyView();
  // Remove the transition class after it plays so drag/wheel don't feel laggy.
  setTimeout(() => gRoot.classList.remove('smooth'), 380);
}

function wireInteraction() {
  const svg = $('#map');
  const tip = $('#tooltip');
  let lastHoverEl = null;

  svg.addEventListener('mousemove', (e) => {
    const el = e.target.closest('.country, .point-marker');
    const iso3 = el?.dataset.iso3;
    const c = iso3 ? state.atlas.countries.find((x) => x.iso3 === iso3) : null;
    if (!c) { tip.classList.remove('on'); return; }

    // Raise the hovered country's path to the end of its parent so its dark
    // hover stroke isn't overpainted by neighbouring countries' white strokes.
    // Only when the hovered country actually changes — moving within one
    // country would otherwise thrash the DOM.
    if (el && el !== lastHoverEl && el.parentNode) {
      el.parentNode.appendChild(el);
      lastHoverEl = el;
    }

    let line;
    if (state.indicator) {
      const v = c.tier === 'status' ? VALUE.nodata : valueOf(c.indicators[state.indicator]?.written);
      line = `${indicatorName(state.indicator)} — ${valueLabel(v.key)}`;
    } else {
      line = statusLabel(c.status);
    }
    tip.innerHTML = `<div class="t-name">${esc(countryName(c.iso3))}</div><div class="t-status">${esc(line)}</div>`;
    tip.classList.add('on');
    tip.style.left = Math.min(e.clientX + 14, innerWidth - 260) + 'px';
    tip.style.top = e.clientY + 16 + 'px';
  });
  svg.addEventListener('mouseleave', () => tip.classList.remove('on'));

  let moved = false;
  svg.addEventListener('click', (e) => {
    if (moved) return;
    const el = e.target.closest('.country, .point-marker');
    if (el?.dataset.iso3) openCountry(el.dataset.iso3);
    else closeDrawer();
  });

  // Pan
  let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
  svg.addEventListener('mousedown', (e) => {
    dragging = true; moved = false;
    sx = e.clientX; sy = e.clientY; ox = state.view.x; oy = state.view.y;
    svg.classList.add('dragging');
  });
  addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    // Convert screen pixels to viewBox units so panning tracks the cursor.
    const vb = svg.viewBox.baseVal;
    const scale = vb.width / svg.clientWidth;
    state.view.x = ox + dx * scale;
    state.view.y = oy + dy * scale;
    applyView();
  });
  addEventListener('mouseup', () => { dragging = false; svg.classList.remove('dragging'); });

  // Zoom
  const zoomBy = (factor) => {
    state.view.k = Math.max(1, Math.min(12, state.view.k * factor));
    if (state.view.k === 1) { state.view.x = 0; state.view.y = 0; }
    applyView();
  };
  svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15); }, { passive: false });
  $('#zoom-in').onclick = () => zoomBy(1.4);
  $('#zoom-out').onclick = () => zoomBy(1 / 1.4);
  $('#zoom-reset').onclick = () => { state.view = { x: 0, y: 0, k: 1 }; applyView(); };

  $('#close-drawer').onclick = closeDrawer;
  addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  // Search matches on the localised name AND the English name, so "Kenia"
  // and "Kenya" both work regardless of the current language.
  const search = $('#search');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    if (q.length < 2) return;
    const hit = state.atlas.countries.find((c) => {
      return countryName(c.iso3).toLowerCase().startsWith(q) ||
             c.name.toLowerCase().startsWith(q);
    });
    if (hit) openCountry(hit.iso3);
  });

  addEventListener('hashchange', () => {
    const m = location.hash.match(/^#\/country\/([a-z]{3})$/i);
    if (m) openCountry(m[1].toUpperCase());
    else if (state.selected) closeDrawer();
  });
}

// ---------------------------------------------------------------------------

async function init() {
  const screen = $('#status-screen');

  let loaded, world;
  try {
    // i18n runs alongside data loading — same wall-clock, but it must complete
    // before the first render so static labels never briefly flash English.
    [loaded, world] = await Promise.all([
      loadAtlas(),
      fetchWithTimeout('data/world.geo.json', CONFIG.localTimeoutMs).then((r) => r.json()),
      initI18n(),
    ]);
  } catch (err) {
    screen.innerHTML = `<div><div class="msg">${esc(t('ui', 'error.load'))}</div>
      <div class="sub">${esc(err.message)}<br>${esc(t('ui', 'error.serve'))}</div></div>`;
    return;
  }

  state.atlas = loaded.atlas;

  // Resolve every country to its geometry here rather than trusting the fields
  // baked by the build script — the live path never runs that script, and a
  // half-populated join shows up as a silently grey map.
  const geomIds = new Set(world.features.map((f) => f.id));
  const undrawable = [];
  for (const c of state.atlas.countries) {
    c.num = ISO3_TO_NUM[c.iso3] || null;
    c.render = !c.iso3 ? 'none'
      : geomIds.has(c.num) ? 'shape'
      : SMALL_STATE_POINTS[c.iso3] ? 'point'
      : 'none';
    if (c.render === 'shape') state.byNum.set(c.num, c);
    else if (c.render === 'none') undrawable.push(c.name);
  }
  if (undrawable.length) {
    console.warn(`[atlas] ${undrawable.length} country/countries could not be drawn:`, undrawable);
  }

  // Documents are additive: a missing or malformed manifest must degrade to
  // "no Documents section", never to a broken map. Deliberately not in the
  // Promise.all above — it is not worth delaying first paint for.
  fetchWithTimeout('data/documents.json', CONFIG.localTimeoutMs)
    .then((r) => (r.ok ? r.json() : {}))
    .then((docs) => {
      state.documents = docs ?? {};
      // Repaint the drawer if the user opened a country before this landed.
      if (state.selected) openCountry(state.selected);
    })
    .catch(() => { state.documents = {}; });

  paintProvenance($('#provenance'), loaded);

  $('#country-count').textContent = t('ui', 'header.countries', { n: state.atlas.meta.countryCount });
  $('#profile-count').textContent = t('ui', 'header.fullProfiles', { n: state.atlas.meta.fullProfileCount });
  $('#scope-note').textContent = t('ui', 'map.scopeNote', { n: state.atlas.meta.fullProfileCount });

  renderLegend();
  renderIndicatorPicker();
  renderMap(world);
  wireInteraction();

  screen.hidden = true;

  const m = location.hash.match(/^#\/country\/([a-z]{3})$/i);
  if (m) openCountry(m[1].toUpperCase());
}

init();
