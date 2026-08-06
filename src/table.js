// Flat data table. PRD.md §5.5.
//
// Long format: one row per country × requirement, so it can be searched,
// sorted, filtered and exported without the user fighting a 34-column grid.
// Unglamorous, but it is what researchers ask for within five minutes.

import { STATUS, valueOf, enforcementOf } from './parse-atlas.js';
import { loadAtlas, paintProvenance, esc } from './data.js';
import { renderSources, sourceToText } from './sources.js';
import { initI18n, t, countryName, statusLabel, valueLabel, groupName, indicatorName } from './i18n.js';

const $ = (s) => document.querySelector(s);

const state = {
  atlas: null,
  rows: [],
  view: [],
  sort: { key: 'country', dir: 1 },
  filters: { q: '', country: '', group: '', value: '' },
};

// ---------------------------------------------------------------------------

function buildRows(atlas) {
  const rows = [];
  const indicators = atlas.indicators.filter((i) => !i.isLegislation);

  for (const c of atlas.countries) {
    for (const ind of indicators) {
      const rec = c.indicators[ind.slug];
      // Only rows that carry something. An exhaustive 112 × 33 grid of mostly
      // blanks would bury the data that exists.
      if (!rec || (!rec.written && !rec.notes && !rec.source)) continue;

      const v = valueOf(rec.written);
      rows.push({
        country: c.name,
        iso3: c.iso3,
        status: c.status,
        group: ind.group,
        indicator: ind.name,
        slug: ind.slug,
        value: v.key,
        valueLabel: v.label,
        valueColor: v.color,
        enforced: rec.enforced ? (enforcementOf(rec.enforced)?.label ?? rec.enforced) : '',
        source: rec.source || '',
        notes: rec.notes || '',
      });
    }
  }
  return rows;
}

function applyFilters() {
  const { q, country, group, value } = state.filters;
  const needle = q.trim().toLowerCase();

  state.view = state.rows.filter((r) => {
    if (country && r.iso3 !== country) return false;
    if (group && r.group !== group) return false;
    if (value && r.value !== value) return false;
    if (!needle) return true;
    // Search matches both localised and English strings, so a query in either
    // language finds the row.
    return (
      countryName(r.iso3).toLowerCase().includes(needle) ||
      r.country.toLowerCase().includes(needle) ||
      indicatorName(r.slug).toLowerCase().includes(needle) ||
      r.indicator.toLowerCase().includes(needle) ||
      groupName(r.group).toLowerCase().includes(needle) ||
      r.notes.toLowerCase().includes(needle) ||
      r.source.toLowerCase().includes(needle)
    );
  });

  const { key, dir } = state.sort;
  // Sort by what the user sees: localised country/requirement/group names.
  const sortVal = (r) => key === 'country' ? countryName(r.iso3)
    : key === 'indicator' ? indicatorName(r.slug)
    : key === 'group' ? groupName(r.group)
    : key === 'value' ? valueLabel(r.value)
    : r[key];
  state.view.sort((a, b) => {
    return String(sortVal(a) ?? '').localeCompare(String(sortVal(b) ?? '')) * dir
      || countryName(a.iso3).localeCompare(countryName(b.iso3));
  });
}

function render() {
  applyFilters();

  const tbody = $('#tbody');
  const frag = document.createDocumentFragment();

  for (const r of state.view) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="c-country">
        <a href="index.html#/country/${r.iso3.toLowerCase()}">${esc(countryName(r.iso3))}</a>
        <span class="sw-status" style="background:${STATUS[r.status].color}" title="${esc(statusLabel(r.status))}"></span>
      </td>
      <td class="c-group">${esc(groupName(r.group))}</td>
      <td class="c-ind">${esc(indicatorName(r.slug))}</td>
      <td class="c-val">
        <span class="sw" style="background:${r.valueColor}"></span>${esc(valueLabel(r.value))}
        ${r.enforced ? `<span class="enf" title="${esc(t('ui', 'drawer.enforcementNote'))}">${esc(r.enforced)}</span>` : ''}
      </td>
      <td class="c-src">${r.source ? renderSources(r.source) : '<span class="none">—</span>'}</td>
      <td class="c-notes">${r.notes ? `<div class="clamp">${esc(r.notes)}</div>` : '<span class="none">—</span>'}</td>`;
    frag.appendChild(tr);
  }

  tbody.replaceChildren(frag);

  $('#row-count').textContent = t('ui', 'data.rowCount', {
    n: state.view.length.toLocaleString(), total: state.rows.length.toLocaleString(),
  });
  $('#empty').hidden = state.view.length > 0;

  for (const th of document.querySelectorAll('th.sortable')) {
    const on = th.dataset.sort === state.sort.key;
    th.setAttribute('aria-sort', on ? (state.sort.dir === 1 ? 'ascending' : 'descending') : 'none');
  }

  // Notes are long; let a click expand the one you care about.
  for (const el of tbody.querySelectorAll('.clamp')) {
    el.onclick = () => el.classList.toggle('open');
  }
}

// ---------------------------------------------------------------------------

function exportCSV() {
  const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const lines = [
    [
      t('ui', 'data.head.country'), 'ISO3', 'National status',
      t('ui', 'data.head.group'), t('ui', 'data.head.requirement'),
      t('ui', 'data.head.value'), t('ui', 'drawer.detail.enforcement'),
      t('ui', 'data.head.source'), t('ui', 'data.head.notes'),
    ].map(q).join(','),
  ];

  for (const r of state.view) {
    lines.push([
      countryName(r.iso3), r.iso3, statusLabel(r.status),
      groupName(r.group), indicatorName(r.slug),
      valueLabel(r.value), r.enforced, sourceToText(r.source), r.notes,
    ].map(q).join(','));
  }

  // Provenance travels with the file, and it says plainly whether this is the
  // whole dataset or a filtered slice.
  const filtered = state.view.length !== state.rows.length;
  lines.push('');
  lines.push(q(`${t('ui', 'brand.org')} — ${t('ui', 'brand.title')}`));
  lines.push(q(`Exported ${new Date().toISOString().slice(0, 10)} from ${location.href}`));
  lines.push(q(filtered
    ? `Filtered view: ${state.view.length} of ${state.rows.length} rows.`
    : `Complete dataset: ${state.rows.length} rows.`));

  const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `moto-taxi-atlas-data-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------

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
  state.rows = buildRows(loaded.atlas);
  paintProvenance($('#provenance'), loaded);

  // Populate the country filter with localised names, values keyed on ISO3 so
  // switching language doesn't invalidate the current filter.
  const seen = new Map();
  for (const r of state.rows) if (!seen.has(r.iso3)) seen.set(r.iso3, countryName(r.iso3));
  const countries = [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  for (const [iso3, name] of countries) $('#f-country').add(new Option(name, iso3));
  for (const g of state.atlas.groups) {
    if (state.rows.some((r) => r.group === g)) $('#f-group').add(new Option(groupName(g), g));
  }

  let searchT;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(searchT);
    searchT = setTimeout(() => { state.filters.q = e.target.value; render(); }, 120);
  });
  $('#f-country').onchange = (e) => { state.filters.country = e.target.value; render(); };
  $('#f-group').onchange = (e) => { state.filters.group = e.target.value; render(); };
  $('#f-value').onchange = (e) => { state.filters.value = e.target.value; render(); };

  $('#reset').onclick = () => {
    state.filters = { q: '', country: '', group: '', value: '' };
    $('#q').value = ''; $('#f-country').value = ''; $('#f-group').value = ''; $('#f-value').value = '';
    render();
  };
  $('#export-csv').onclick = exportCSV;

  for (const th of document.querySelectorAll('th.sortable')) {
    th.onclick = () => {
      const key = th.dataset.sort;
      state.sort = { key, dir: state.sort.key === key ? -state.sort.dir : 1 };
      render();
    };
  }

  render();
  $('#status-screen').hidden = true;
}

init();
