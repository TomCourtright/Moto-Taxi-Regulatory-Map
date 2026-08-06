// Comparison view. PRD.md §5.4.
//
// The workhorse view for the primary audience: "show me what my peers require
// so I can borrow the language." Every cell carries its source, because a
// regulator cannot cite an unsourced table.

import { STATUS, valueOf, enforcementOf } from './parse-atlas.js';
import { loadAtlas, paintProvenance, esc, renderSources } from './data.js';
import { initI18n, t, countryName, statusLabel, valueLabel, groupName, indicatorName } from './i18n.js';

const $ = (s) => document.querySelector(s);
const MAX = 4;

const state = {
  atlas: null,
  eligible: [],      // full-profile countries, the only ones worth comparing
  selected: [],      // iso3
  diffOnly: false,
  openCell: null,
};

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

function renderChips() {
  const el = $('#country-chips');
  el.innerHTML = '';

  // Order chips by the localised name so the picker reads alphabetically in
  // whichever language the user has chosen.
  const ordered = [...state.eligible].sort(
    (a, b) => countryName(a.iso3).localeCompare(countryName(b.iso3)),
  );

  for (const c of ordered) {
    const on = state.selected.includes(c.iso3);
    const full = state.selected.length >= MAX;

    const b = document.createElement('button');
    b.className = 'cchip' + (on ? ' on' : '');
    b.disabled = !on && full;
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = `<span class="sw" style="background:${STATUS[c.status].color}"></span>${esc(countryName(c.iso3))}`;
    b.onclick = () => {
      state.selected = on
        ? state.selected.filter((x) => x !== c.iso3)
        : [...state.selected, c.iso3];
      syncHash();
      render();
    };
    el.appendChild(b);
  }
}

function syncHash() {
  location.hash = state.selected.length
    ? `#/compare/${state.selected.map((s) => s.toLowerCase()).join(',')}`
    : '#/compare';
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

function selectedCountries() {
  return state.selected
    .map((iso3) => state.atlas.countries.find((c) => c.iso3 === iso3))
    .filter(Boolean);
}

function renderTable() {
  const wrap = $('#table-wrap');
  const picked = selectedCountries();

  if (picked.length < 2) {
    wrap.innerHTML = '';
    $('#toolbar').hidden = true;
    $('#hint').hidden = false;
    return;
  }

  $('#hint').hidden = true;
  $('#toolbar').hidden = false;

  const indicators = state.atlas.indicators.filter((i) => !i.isLegislation);

  // "Differs" means the published value differs, not the raw sheet string —
  // otherwise "Mixed status" and "It's complicated" would read as a difference
  // when they mean the same thing.
  const differs = (ind) => {
    const vals = picked.map((c) => valueOf(c.indicators[ind.slug]?.written).key);
    return new Set(vals).size > 1;
  };

  const rows = state.diffOnly ? indicators.filter(differs) : indicators;
  $('#row-count').textContent = t('ui', 'compare.rowCount', {
    n: rows.length, total: indicators.length,
  });

  let html = `<table class="cmp"><thead><tr><th class="ind-col">${esc(t('ui', 'compare.head.requirement'))}</th>`;
  for (const c of picked) {
    html += `<th>
      <a class="cn" href="index.html#/country/${c.iso3.toLowerCase()}">${esc(countryName(c.iso3))}</a>
      <span class="pill status" style="background:${STATUS[c.status].color}">${esc(statusLabel(c.status))}</span>
    </th>`;
  }
  html += `</tr></thead><tbody>`;

  let lastGroup = null;
  for (const ind of rows) {
    if (ind.group !== lastGroup) {
      lastGroup = ind.group;
      html += `<tr class="grouprow"><td colspan="${picked.length + 1}">${esc(groupName(ind.group))}</td></tr>`;
    }

    const diff = differs(ind);
    html += `<tr class="${diff ? 'is-diff' : ''}"><th class="ind-col">${esc(indicatorName(ind.slug))}</th>`;

    for (const c of picked) {
      const rec = c.indicators[ind.slug];
      const v = valueOf(rec?.written);
      const hasDetail = !!(rec && (rec.notes || rec.source || rec.enforced));
      const id = `${c.iso3}-${ind.slug}`;

      html += `<td>
        <button class="cell${hasDetail ? '' : ' bare'}" data-cell="${id}"${hasDetail ? '' : ' disabled'}>
          <span class="sw" style="background:${v.color}"></span>
          <span class="vlabel">${esc(valueLabel(v.key))}</span>
          ${hasDetail ? '<span class="more">+</span>' : ''}
        </button>
        ${hasDetail ? `<div class="celldetail" id="cd-${id}" hidden>
          ${rec.notes ? `<div class="blk"><span class="lbl">${esc(t('ui', 'drawer.detail.notes'))}</span><p>${esc(rec.notes)}</p></div>` : ''}
          ${rec.source ? `<div class="blk"><span class="lbl">${esc(t('ui', 'drawer.detail.source'))}</span>${renderSources(rec.source)}</div>` : ''}
          ${rec.enforced ? `<div class="blk"><span class="lbl">${esc(t('ui', 'drawer.detail.enforcement'))}</span><p>${esc(enforcementOf(rec.enforced)?.label ?? rec.enforced)}</p></div>` : ''}
        </div>` : ''}
      </td>`;
    }
    html += `</tr>`;
  }

  html += `</tbody></table>`;
  wrap.innerHTML = html;

  for (const btn of wrap.querySelectorAll('.cell:not(.bare)')) {
    btn.onclick = () => {
      const d = wrap.querySelector(`#cd-${CSS.escape(btn.dataset.cell)}`);
      const wasOpen = !d.hidden;
      for (const other of wrap.querySelectorAll('.celldetail')) other.hidden = true;
      d.hidden = wasOpen;
    };
  }
}

function render() {
  renderChips();
  renderTable();
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function exportCSV() {
  const picked = selectedCountries();
  const all = state.atlas.indicators.filter((i) => !i.isLegislation);

  // Export what is on screen. A file that silently contains more rows than the
  // table the user was looking at is a quiet way to mislead them.
  const indicators = state.diffOnly
    ? all.filter((ind) => new Set(picked.map((c) => valueOf(c.indicators[ind.slug]?.written).key)).size > 1)
    : all;

  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [];

  const H_GROUP = t('ui', 'data.head.group');
  const H_REQ   = t('ui', 'data.head.requirement');
  const H_STAT  = t('ui', 'drawer.detail.status');
  const H_SRC   = t('ui', 'drawer.detail.source');
  const H_NOTES = t('ui', 'drawer.detail.notes');

  lines.push([
    H_GROUP, H_REQ,
    ...picked.flatMap((c) => {
      const n = countryName(c.iso3);
      return [`${n} — ${H_STAT}`, `${n} — ${H_SRC}`, `${n} — ${H_NOTES}`];
    }),
  ].map(q).join(','));

  for (const ind of indicators) {
    lines.push([
      groupName(ind.group), indicatorName(ind.slug),
      ...picked.flatMap((c) => {
        const rec = c.indicators[ind.slug];
        return [valueLabel(valueOf(rec?.written).key), rec?.source ?? '', rec?.notes ?? ''];
      }),
    ].map(q).join(','));
  }

  // Provenance travels with the file — a CSV that outlives this page still
  // needs to say where it came from and when.
  lines.push('');
  lines.push(q(`${t('ui', 'brand.org')} — ${t('ui', 'brand.title')}`));
  lines.push(q(`Exported ${new Date().toISOString().slice(0, 10)} from ${location.href}`));
  lines.push(q(state.diffOnly
    ? `Filtered: only the ${indicators.length} of ${all.length} requirements where the selected countries differ.`
    : `All ${all.length} requirements.`));

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `moto-taxi-atlas-${picked.map((c) => c.iso3.toLowerCase()).join('-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------

function readHash() {
  const m = location.hash.match(/^#\/compare\/([a-z,]+)$/i);
  if (!m) return [];
  return m[1].split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((iso3) => state.eligible.some((c) => c.iso3 === iso3))
    .slice(0, MAX);
}

async function init() {
  let loaded;
  try {
    [loaded] = await Promise.all([loadAtlas(), initI18n()]);
  } catch (err) {
    $('#status-screen').innerHTML =
      `<div><div class="msg">${esc(t('ui', 'error.load'))}</div><div class="sub">${esc(err.message)}</div></div>`;
    return;
  }

  state.atlas = loaded.atlas;
  state.eligible = state.atlas.countries
    .filter((c) => c.tier === 'full' || c.tier === 'partial');
  // Sorted at render time by localised name, so the language switch reorders it.

  paintProvenance($('#provenance'), loaded);
  $('#full-count').textContent = String(state.eligible.length);

  state.selected = readHash();

  $('#diff-only').onchange = (e) => { state.diffOnly = e.target.checked; renderTable(); };
  $('#export-csv').onclick = exportCSV;
  addEventListener('hashchange', () => { state.selected = readHash(); render(); });

  render();
  $('#status-screen').hidden = true;
}

init();
