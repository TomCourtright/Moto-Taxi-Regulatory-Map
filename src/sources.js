// Source citation parsing and rendering. See SOURCES.md for the authoring rules
// this implements, and PRD.md §5.3.
//
// A regulator needs to see WHAT a document is, not a naked URL. Every rendered
// source therefore leads with a citation and hangs the link off it.
//
// Sheet format (pipe-delimited, all fields but the first optional):
//
//     Citation (Country, Year) | https://url | Art. 6
//
// Multiple sources per cell are separated by a newline or a semicolon.
//
// Two things are DERIVED rather than typed, so they stay consistent across
// hundreds of entries and nobody has to remember them:
//   - the host, and whether it is an official source or a third-party mirror
//   - the year, read from the citation's parentheses
//
// Legacy entries (bare URLs, or "Title; https://…") still parse; they just
// render without a pinpoint and are flagged as needing a citation.

// Hosts that are mirrors/uploads rather than the issuing authority. A researcher
// wants to know when a citation rests on one of these, because they rot and
// carry no guarantee of being the operative text.
const THIRD_PARTY = [
  'scribd.com', 'archive.org', 'dropbox.com', 'drive.google.com', 'docs.google.com',
  'academia.edu', 'researchgate.net', 'issuu.com', 'slideshare.net', 'wordpress.com',
  'medium.com', 'wikipedia.org', 'vietnamexploration.com', 'pdfcoffee.com', 'studylib.net',
];

// Markers of an official or authoritative publisher: government, gazette,
// parliament, or a national legal-information institute.
const OFFICIAL_HINTS = [
  '.gov', '.go.', '.gouv.', '.gob.', '.govt.', '.gv.', '.gc.ca',
  'gazette', 'parliament', 'assemblee', 'asamblea', 'senado', 'senate',
  'kenyalaw', 'ulii', 'lawsofnigeria', 'legis', 'laws.', 'peraturan', 'thuvienphapluat',
  'rura.rw', 'ntsa.', 'dlt.go.th', 'un.org', 'who.int', 'worldbank.org',
];

const PINPOINT_RE =
  /^(art\.?|article|arts\.?|sec\.?|section|§+|reg\.?|regulation|rule|para\.?|paragraph|ch\.?|chapter|sched|schedule|clause|pt\.?|part)\b/i;

function classifyHost(url) {
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return { host: '', thirdParty: false, official: false }; }

  const thirdParty = THIRD_PARTY.some((h) => host.endsWith(h) || host.includes(h));
  const official = !thirdParty && OFFICIAL_HINTS.some((h) => host.includes(h));
  return { host, thirdParty, official };
}

// Split a cell into individual source entries. Newline is the preferred
// separator (Alt+Enter in Sheets); semicolon is kept for the legacy entries.
export function splitSources(raw) {
  return String(raw ?? '')
    .split(/\n+|\s*;\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parseSource(entry) {
  const fields = entry.split('|').map((f) => f.trim()).filter(Boolean);

  let citation = '';
  let url = null;
  let pinpoint = null;

  for (const f of fields) {
    const found = f.match(/https?:\/\/\S+/);
    if (found && !url) {
      url = found[0].replace(/[.,;)\]]+$/, '');
      // "Title https://…" in one field: the remainder is the citation.
      const rest = f.replace(found[0], '').replace(/^[\s—–\-:,.]+|[\s—–\-:,.]+$/g, '').trim();
      if (rest && !citation) citation = rest;
      continue;
    }
    if (PINPOINT_RE.test(f) && !pinpoint) { pinpoint = f; continue; }
    if (!citation) citation = f;
    else if (!pinpoint) pinpoint = f;
  }

  const { host, thirdParty, official } = url ? classifyHost(url) : { host: '', thirdParty: false, official: false };

  // Year from the citation's parentheses — "(Gabon, 2011)" or "(2024)".
  const yearMatch = citation.match(/\((?:[^)]*?,\s*)?((?:19|20)\d{2})\)/);
  const year = yearMatch ? yearMatch[1] : null;

  // An entry needs work if it has no human-readable citation at all.
  const untitled = !citation;

  // Fall back in order: the pinpoint (a bare "Article 75" is at least readable),
  // then the host, then the raw URL. Something must be clickable.
  let label = citation;
  if (!label && pinpoint) { label = pinpoint; pinpoint = null; }
  if (!label) label = host || url || '';

  return {
    citation: label,
    url,
    // Never repeat the host when it is already doing duty as the label.
    pinpoint,
    host,
    thirdParty: thirdParty && label !== host,
    official,
    year,
    untitled,
  };
}

export function parseSources(raw) {
  return splitSources(raw).map(parseSource);
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

// Localised labels for the flags. Falls back to English if i18n has not
// initialised yet (build-time / early boot).
function i18nLabels() {
  const t = window.__atlasI18n?.t;
  return t ? {
    noLink:  t('ui', 'sources.noLink.title'),
    via:     t('ui', 'sources.via'),
    viaTip:  t('ui', 'sources.via.title'),
    needs:   t('ui', 'sources.needsCitation'),
    needsTip:t('ui', 'sources.needsCitation.title'),
  } : {
    noLink:  'No link recorded in the sheet.',
    via:     'via',
    viaTip:  'Third-party repository, not the issuing authority. Link may not be durable.',
    needs:   'needs citation',
    needsTip:'No citation recorded — only a link. Needs a proper legal citation in the sheet.',
  };
}

export function renderSources(raw) {
  const list = parseSources(raw);
  if (!list.length) return '';
  const L = i18nLabels();

  const items = list.map((s) => {
    const label = esc(s.citation);
    const head = s.url
      ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${label}</a>`
      : `<span class="no-link" title="${esc(L.noLink)}">${label}</span>`;

    const bits = [];
    if (s.pinpoint) bits.push(`<span class="pinpoint">${esc(s.pinpoint)}</span>`);
    if (s.thirdParty && s.host) {
      bits.push(`<span class="via" title="${esc(L.viaTip)}">${esc(L.via)} ${esc(s.host)}</span>`);
    }
    if (s.untitled) {
      bits.push(`<span class="untitled" title="${esc(L.needsTip)}">${esc(L.needs)}</span>`);
    }

    return `<li>${head}${bits.length ? ` <span class="meta">${bits.join(' · ')}</span>` : ''}</li>`;
  });

  return `<ul class="sources">${items.join('')}</ul>`;
}

// Plain-text form, for CSV export.
export function sourceToText(raw) {
  return parseSources(raw)
    .map((s) => [s.citation, s.pinpoint, s.url, s.thirdParty && s.host ? `via ${s.host}` : null]
      .filter(Boolean).join(' — '))
    .join(' ; ');
}
