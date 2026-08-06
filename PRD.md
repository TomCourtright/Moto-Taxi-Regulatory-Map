# Global Moto-Taxi Regulation Atlas — PRD

**Owner:** Tom Courtright
**Publisher:** Global Network for Popular Transportation (GNPT)
**Date:** 21 July 2026
**Status:** Draft for review

---

## 1. What this is

An interactive map and policy atlas of moto-taxi regulation in 112 countries, built on
GNPT's own research. It answers, for a named country: *is this sector regulated, what
exactly is required of drivers and vehicles, and where is that written down?*

It supersedes an earlier prototype (see `Map 1.png`, `Map 2.png`, `Map 3.png`), whose
source was lost. Those screenshots define the visual direction and are treated as the
design reference, not as a spec to reproduce literally.

### Primary audience

**Policymakers and regulators.** The design brief follows from this:

- Every claim carries a **visible source**. A regulator cannot cite an unsourced map.
- **Country-vs-country comparison is a first-class view**, not an afterthought — the core
  job is "show me what my peers require so I can borrow the language."
- Terminology is **plain and non-academic** (see §4.2).
- Everything is **exportable**. Users will want the data in their own documents.

Researchers, advocates and industry are secondary beneficiaries of the same features.

### Non-goals for v1

- Enforcement as an analytical dimension (data too weak — §7.1)
- Sub-national / state-level regulation (§7.2)
- User accounts, comments, or any backend
- Editing data in the product. The Google Sheet is the only source of truth.

---

## 2. The data

### 2.1 Source of truth

A single Google Sheet, published to the web:

```
https://docs.google.com/spreadsheets/d/e/2PACX-1vQtzoKLQsRshikHltqLvDxYInnl0qyu-SyK00eEaIQSl-xoDEwadn2TXIt3QT7niB2tKvOs-KGPye_g/pub?gid=1544705327&single=true&output=csv
```

Verified 21 Jul 2026: HTTP 200, `text/csv; charset=utf-8`, `Access-Control-Allow-Origin: *`,
116,223 bytes — byte-identical to `Regulations (Static - July 21).csv`. Browser-side fetch
works with no proxy or API key.

> Note: the shared link was a `pubhtml` URL. The CSV endpoint is the same URL with
> `pubhtml?` replaced by `pub?` and `&output=csv` appended. If the sheet is ever
> re-published, this URL changes and must be updated in `config.js`.

### 2.2 Shape

Two header rows, then each country occupies a **4-row block**:

| Row | Meaning |
|---|---|
| `Written` | Does the requirement exist in law? |
| `Enforced` | Is it enforced in practice? |
| `Source` | Citation — free text, sometimes a URL |
| `Notes` | Free prose, often substantial |

Column A holds the country name on the first row of its block only. Column B holds a
country-level summary sentence. Column C holds the row label. Columns D–AL hold
**34 indicators** in 7 groups — the legislation status plus 33 detailed requirements.
(An earlier draft said 35: the trailing "Compliance Data" group header has no
indicator name beneath it, and is correctly skipped by the parser.)

| Group | Count |
|---|---|
| Legislation Addressing Moto-Taxis | 1 |
| Driver Requirements | 9 |
| Vehicle Requirements | 7 |
| Passenger Safety & Service Standards | 6 |
| Membership & Organizational Structure | 5 |
| Fees, Financial Requirements | 5 |
| Other | 1 |

### 2.3 Known data conditions

These are facts about the data as of 21 Jul 2026, confirmed by inspection. The parser
must handle each without human intervention.

1. **A trailing nameless block.** CSV lines 520–523 are an empty 4-row block with no
   country in column A. A naive parser attributes it to Bhutan, producing a phantom
   113th country. **The parser drops blocks with no name.** There are no duplicate
   country rows — 112 unique names.
2. **Multi-line cells.** Notes and Source cells contain embedded newlines, commas,
   smart quotes and doubled quotes. Requires a real RFC 4180 CSV parser, not `split(',')`.
3. **Trailing whitespace** on several country names and summary cells. Trim on ingest.
4. **Two synonymous "unclear" values.** `Mixed status` and `It's complicated` mean the
   same thing. The parser **normalises `It's complicated` → `Mixed status`.**
5. **Sparse enforcement.** The `Enforced` row is empty for most countries and most
   indicators.

### 2.4 The two-tier problem — and how the product handles it

Coverage is sharply bimodal:

| Tier | Countries | Indicators filled (of 33) |
|---|---|---|
| **Full profile** | 20 | 25–34 |
| Partial | 2 | 10–24 |
| **Status only** | 90 | 1–9 |

The 20 full-profile countries include Tanzania, Liberia, Ghana, Republic of the Congo,
Rwanda, Dominican Republic, Indonesia, Venezuela, Benin, Thailand, Cameroon, Kenya,
Sierra Leone, Angola and Togo.

**Decision: show the tier openly.** Pretending a 3-field country is comparable to a
34-field one would mislead exactly the audience this is built for.

- All 112 countries are coloured on the status map. Status is reliable for all of them.
- Full-profile countries carry a **"Full profile"** badge in the drawer and a subtle
  marker on the map.
- **Indicator mode and the comparison table are restricted to full-profile countries**,
  with an explicit on-screen note saying so and naming the count.
- A **coverage view** lists which countries lack deep data. This doubles as GNPT's
  research roadmap and turns a weakness into an honest editorial statement.

The tier is computed from the data at build time, never hardcoded, so it improves
automatically as the sheet is filled in.

---

## 3. Data pipeline

**Live fetch with baked fallback.**

```
Google Sheet (published CSV)
        │
        ├── build: node scripts/build-data.mjs  →  data/atlas.json  (baked snapshot)
        │
        └── runtime: fetch live CSV
                     ├── success → parse in browser, use it, show "Live · <date>"
                     └── failure/timeout (6s) → use baked atlas.json, show "Snapshot · <date>"
```

One parser module (`src/parse-atlas.js`) is used by **both** the build script and the
browser, so the two paths cannot drift. This is the whole reason the hybrid approach is
affordable.

The status line is always visible. A user must be able to tell whether they are looking
at live or cached data — for a policy audience that is a correctness requirement.

If the live CSV parses to fewer than 100 countries, it is treated as malformed and the
baked snapshot is used instead. This prevents a mid-edit sheet from blanking the map.

---

## 4. Vocabulary

### 4.1 Why it changes

The sheet's internal vocabulary is research shorthand. The published vocabulary is for
policymakers. The mapping is applied at render time; **the sheet is never edited to suit
the website.**

### 4.2 Legislation status (column D — drives the map colour)

| In the sheet | Published label | Meaning | Count |
|---|---|---|---|
| `Present` | **Nationally Regulated** | National law addresses moto-taxis | 19 |
| `Fragmented` / `Mixed status` | **Locally Regulated** | No national framework; cities or states regulate | 18 |
| `Prohibited` | **Prohibited** | Banned at national level | 18 |
| `Not present` | **Unregulated** | No law addresses the sector | 57 |
| *(blank)* | **No data** | Not yet researched | 0* |

\* One blank existed in the static CSV; it belongs to the phantom block removed by §2.3.1.

### 4.3 Indicator values (columns E–AL)

| In the sheet | Published label |
|---|---|
| `Present` | Required |
| `Not present` | Not required |
| `Mixed status` / `It's complicated` | Mixed / unclear |
| `No data` | No data |
| *(blank)* | No data |

---

## 5. Views

### 5.1 Status map — the landing view

Choropleth of all 112 countries by legislation status, four colours plus grey. Carries
over from the prototype: legend doubles as a filter, headline counts top-right, warm
off-white ground, editorial serif + mono type.

- Click a country → drawer (§5.3)
- Hover → tooltip with country, published status, local name
- Deep-linked as `#/map`

### 5.2 Indicator mode

Recolour the map by any one of the 33 non-legislation indicators — "Passenger helmet",
"Insurance (third party / liability)", "Vehicle quality check" — using the §4.3 palette.
Turns one map into 34.

Restricted to full-profile countries; all others render as "No data" with a persistent
note explaining that indicator-level research exists for 20 countries. Deep-linked as
`#/map/indicator/<slug>`.

### 5.3 Country drawer

Follows `Map 3.png`: title, local name, status pill, summary prose, requirement chips
grouped by the 7 categories, and sources. Adds:

- **"Full profile"** badge where applicable
- **Documents** section (§6)
- Per-indicator Notes revealed on click — this is the richest content in the dataset and
  the prototype buried it
- Permalink `#/country/<iso3>`, and a **Copy citation** button

### 5.4 Comparison

Pick 2–4 full-profile countries; all 34 indicators side by side, grouped, with sources
and notes. Rows where all selected countries agree can be collapsed, so difference is
what shows. Deep-linked as `#/compare/ken,tza,rwa`. Exports to CSV.

This is the view the primary audience will actually use. It gets the most design care.

### 5.5 Data table

Flat, sortable, filterable table of every country × indicator, with search across notes
and sources. Full CSV export of either the whole dataset or the current filter.
Deep-linked as `#/data`.

### 5.6 Coverage

Which countries have full profiles, which have status only, and the per-indicator fill
rate. Honest about the state of the research (§2.4). Deep-linked as `#/coverage`.

### 5.7 Case studies

A Markdown-driven page type. Layout: standfirst, the country's status card, prose
sections, pull quotes, sources.

Claude drafts initial versions **from the existing CSV Notes** for the four countries
whose notes already contain narrative — **Uganda, Rwanda, Indonesia, Thailand**. These
ship as clearly-marked drafts for Tom to edit and are not published as GNPT positions
until he has done so. Deep-linked as `#/case/<slug>`.

---

## 6. Documents (PDFs)

The schema and UI slot are built now; no files exist yet.

- Files live in `assets/pdfs/<iso3>/`
- `data/documents.json` maps country → `[{title, filename, language, year, official}]`
- The drawer renders a **Documents** section from that manifest; the section is hidden
  when a country has none
- Where a source has a URL but no local PDF, the drawer links out and marks it
  "external link — may expire"

Adding a document is: drop the file in, add a line to the manifest. No code changes.

---

## 7. Deferred — recorded so they are not forgotten

### 7.1 Enforcement
The sheet has an `Enforced` row per indicator (`Very commonly` → `Rarely / Never`), and
the written-vs-enforced gap is arguably the most original insight in the research —
Uganda's summary calls it "a big gap between policy and police." **The data is currently
too sparse and too subjective to map.** v1 displays enforcement in the drawer where it
exists, clearly marked as indicative, and does not filter, rank or colour by it. Revisit
when coverage improves.

### 7.2 Sub-national regulation
The Notes are full of city- and state-level fact — Nairobi's CBD ban, Antigua Guatemala's
app ban, La Rioja's ordinance, Hanoi's Ring Road 1 phase-out. For v1 this is **text in
the country drawer only.**

Post-v1, Tom wants **state-level regulation** for federal countries: **India, Mexico,
Brazil, Nigeria.** This requires a second sheet keyed on sub-national admin codes and
admin-1 boundaries in the map data. The data schema uses a `level` field (`national` /
`subnational`) from the start so this is additive rather than a rewrite.

### 7.3 Local names
`Map 2.png` and `Map 3.png` showed local terms ("Mototaxi", "Boda boda") under the country
title. **This is not in the CSV and its origin is unknown.** For v1 a `data/local-names.json`
file exists with the handful recoverable from the Notes; every entry is marked unverified
and the field is hidden where absent. **This needs a proper pass** — a wrong local name in
front of a national regulator is a credibility problem. Best filled as a column in the
sheet.

### 7.4 Full translation of long-form content
See §8.

---

## 8. Languages

**English, Spanish, French.** Scope for v1:

| Content | v1 |
|---|---|
| Interface labels, navigation, buttons | Translated |
| 34 indicator names + 7 group names | Translated |
| Status and value vocabulary (§4) | Translated |
| Country names | Translated |
| Country summary sentences (col B) | Translated |
| **Notes** | **English only** |
| **Sources** | **Untranslated** — they cite primary law by its official title |

Long-form Notes quote and paraphrase primary legislation. Machine-translating those for a
regulator audience risks putting a wrong statement of law under a GNPT banner. The
architecture supports adding them later with no rework: locale files are keyed per field,
and any missing translation falls back to English **with a visible marker**, never
silently.

Language via `?lang=es` and a switcher; the choice persists in `localStorage` and is
preserved across deep links.

---

## 9. Technical approach

**A small static site. No backend, no build step required to view it.**

Single-file HTML was considered and rejected: hosted PDFs, three locales and case-study
pages do not fit in one file. The map page nonetheless remains **standalone and
iframe-embeddable** for use on the GNPT website.

```
/
├── index.html              # map (default view)
├── compare.html
├── data.html
├── coverage.html
├── case/<slug>.html
├── config.js               # sheet URL, timeouts, feature flags
├── src/
│   ├── parse-atlas.js      # shared parser — build + runtime
│   ├── map.js, compare.js, table.js, i18n.js
│   └── style.css
├── data/
│   ├── atlas.json          # baked snapshot
│   ├── world.topo.json     # boundaries
│   ├── documents.json
│   ├── local-names.json
│   └── locales/{en,es,fr}.json
├── assets/pdfs/<iso3>/
└── scripts/build-data.mjs  # refresh the snapshot
```

- **No framework.** ~112 countries and 34 indicators does not need React.
- **Hash routing** (`#/country/ken`) so deep links work from `file://`, any static host,
  and inside an iframe, with no server config.
- **Relative paths throughout** — host-agnostic, per the brief. Runs from a double-click,
  GitHub Pages, Netlify, or a GNPT web server without modification.
- **Boundaries:** Natural Earth admin-0, UN-style. Western Sahara is rendered as a
  distinct territory with hatching rather than assigned to Morocco. Kosovo, Taiwan,
  Palestine and Crimea follow UN convention. This is a stated editorial position, noted
  in the About text, not a silent default.
- **Accessibility:** colour is never the sole carrier of meaning — every status is also
  labelled in the drawer, tooltip and table. Keyboard-navigable country selection.
  Palette checked for deuteranopia.

### Country identity
Countries are joined to map geometry on **ISO 3166-1 alpha-3**, not on name. A lookup
table maps the sheet's names to ISO3, including the ones that will not match
automatically — `Ivory Coast`, `The Gambia`, `Republic of the Congo` vs `Democratic
Republic of the Congo`, `Cape Verde`, `Sao Tome and Principe`, `Western Sahara`, `Taiwan`.
**Any country in the sheet that fails to resolve is reported loudly by the build script**
rather than silently vanishing from the map.

---

## 10. Attribution

- Byline: **Global Network for Popular Transportation (GNPT)**
- Data licence: **CC BY 4.0** — reuse with attribution, to maximise policy uptake
- Every view shows a **"last updated"** date and whether data is live or snapshot
- Suggested citation, copyable from any country page:

  > Global Network for Popular Transportation (2026). *Global Moto-Taxi Regulation
  > Atlas.* Retrieved [date] from [url]

---

## 11. Success criteria

1. All **112** countries appear on the map, correctly coloured, with **zero** unresolved
   ISO3 joins and no phantom 113th country.
2. The published vocabulary of §4.2 appears everywhere; the sheet's internal terms appear
   nowhere in the interface.
3. Live sheet load succeeds; killing the network still renders the full atlas from the
   snapshot, with the status indicator correctly reporting which was used.
4. A policymaker can go from landing page to a sourced, citable comparison of three
   countries in under 60 seconds without instruction.
5. Every displayed regulatory claim has a visible source or an explicit "no source
   recorded".
6. The tier distinction is impossible to miss and impossible to misread.
7. Deep links survive a copy-paste into an email.
8. Switching to Spanish or French leaves no untranslated interface string, and any
   English fallback content is visibly marked as such.

---

## 12. Build order

1. Parser + `build-data.mjs` → `atlas.json`; ISO3 resolution to zero failures
2. Status map + country drawer *(with §5.1/§5.3 as the working deliverable for day one)*
3. Indicator mode
4. Comparison view
5. Data table + export
6. i18n scaffolding + English locale; Spanish and French
7. Coverage view
8. Case study page type + four drafts
9. Documents slot

## 13. Open questions

- **Local names** (§7.3) — origin unknown, needs a verification pass
- **PDF licensing** — most national legislation is public domain, but this should be
  confirmed per country before hosting rather than linking
- **Spanish/French review** — should a human reviewer check the translated regulatory
  vocabulary before publication?
- **Update cadence** — how often will the sheet change, and should the baked snapshot be
  refreshed on a schedule?
