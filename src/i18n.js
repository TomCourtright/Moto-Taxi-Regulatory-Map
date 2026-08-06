// Internationalisation. PRD.md §8.
//
// Design goal: adding a new language is a JSON edit, not a code change.
// Every user-visible string flows through t(). English is the fallback and any
// missing translation is marked visibly rather than silently substituted —
// invisible fallbacks in a policy document are a correctness problem.

const KNOWN = {
  en: { name: 'English',  flag: 'EN' },
  es: { name: 'Español',  flag: 'ES' },
  fr: { name: 'Français', flag: 'FR' },
};

const STORAGE_KEY = 'atlas.lang';

function detect() {
  const url = new URL(location.href).searchParams.get('lang');
  if (url && KNOWN[url]) return url;

  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && KNOWN[stored]) return stored;

  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return KNOWN[nav] ? nav : 'en';
}

const state = {
  lang: 'en',
  en: null,   // authoritative English catalogue; always loaded so fallback works
  cur: null,  // current language, may equal en
};

async function fetchLocale(lang) {
  const res = await fetch(`data/locales/${lang}.json`);
  if (!res.ok) throw new Error(`Missing locale: ${lang}`);
  return res.json();
}

export async function initI18n() {
  state.lang = detect();
  state.en = await fetchLocale('en');
  state.cur = state.lang === 'en' ? state.en : await fetchLocale(state.lang).catch(() => state.en);

  document.documentElement.lang = state.lang;
  // Expose the lookup for peer modules (data.js paintProvenance) to use
  // without importing i18n directly and risking a circular dependency.
  window.__atlasI18n = { t };
  applyStaticStrings();
  installSwitcher();
}

// Path lookup: t('nav.map'), t('country.KEN'), t('indicator.drivers-license')
function lookup(cat, key) {
  return state.cur?.[cat]?.[key] ?? null;
}

function fallback(cat, key) {
  return state.en?.[cat]?.[key] ?? key;
}

// t returns a raw string; safe for textContent. For HTML use tHtml.
// A missing translation is returned in English with a leading marker character
// that renderMissing() below turns into an underline in the DOM.
export function t(cat, key, vars) {
  const hit = lookup(cat, key);
  const raw = hit ?? '​' + fallback(cat, key);  // ZWSP flag for "untranslated"
  return interp(raw, vars);
}

// HTML form: renders the untranslated marker as a subtle underline with a
// title tooltip. Escapes user data; the template string itself is trusted.
export function tHtml(cat, key, vars) {
  const hit = lookup(cat, key);
  const raw = interp(hit ?? fallback(cat, key), vars, esc);
  if (hit) return raw;
  return `<span class="i18n-missing" title="Untranslated — showing English">${raw}</span>`;
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));

function interp(template, vars, escFn = (x) => x) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? escFn(vars[k]) : ''));
}

// Convenience: translated country name with English fallback + marker.
export function countryName(iso3) { return t('country', iso3); }
export function indicatorName(slug) { return t('indicator', slug); }
export function groupName(name) { return t('group', name); }
export function statusLabel(key) { return t('status', key); }
export function valueLabel(key) { return t('value', key); }

// For fields that are AUTHORED editorial content rather than lookup values,
// callers want to know explicitly whether a translation exists so they can
// mark the fallback visibly.
export function hasSummary(iso3) { return !!lookup('summary', iso3); }
export function summaryOf(iso3) { return lookup('summary', iso3); }

export function currentLang() { return state.lang; }

// --- Static bindings ------------------------------------------------------
//
// Any element with data-t="cat.key" gets its textContent replaced; data-t-attr
// works the same for a specific attribute (title, placeholder, aria-label).
// Missing-translation marker is applied via data-i18n-missing to keep it out
// of DOM textContent.

// Split "ui.brand.title" into ["ui", "brand.title"] — the first segment is the
// category; whatever follows is the key, which may itself contain dots.
function splitPath(s) {
  const i = s.indexOf('.');
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)];
}

function applyStaticStrings() {
  for (const el of document.querySelectorAll('[data-t]')) {
    const [cat, key] = splitPath(el.dataset.t);
    const hit = lookup(cat, key);
    el.textContent = hit ?? fallback(cat, key);
    el.classList.toggle('i18n-missing', !hit);
    if (!hit) el.title = 'Untranslated — showing English';
  }
  for (const el of document.querySelectorAll('[data-t-attr]')) {
    // data-t-attr="placeholder.ui.map.control.placeholder"
    //             ^attr     ^category ^--- key ---^
    const raw = el.dataset.tAttr;
    const firstDot = raw.indexOf('.');
    const attr = raw.slice(0, firstDot);
    const [cat, key] = splitPath(raw.slice(firstDot + 1));
    const val = lookup(cat, key) ?? fallback(cat, key);
    el.setAttribute(attr, val);
  }
}

function installSwitcher() {
  const host = document.querySelector('[data-lang-switcher]');
  if (!host) return;

  const sel = document.createElement('select');
  sel.className = 'lang-switcher';
  sel.setAttribute('aria-label', 'Language');
  for (const code of Object.keys(KNOWN)) {
    const o = new Option(KNOWN[code].name, code);
    o.selected = code === state.lang;
    sel.add(o);
  }
  sel.onchange = () => {
    localStorage.setItem(STORAGE_KEY, sel.value);
    // Rewrite the URL so a copied link preserves the language choice.
    const url = new URL(location.href);
    url.searchParams.set('lang', sel.value);
    location.replace(url);
  };
  host.appendChild(sel);
}
