# How to write sources in the Google Sheet

This is the authoring guide for every **Source** row in the master sheet. The atlas
parses these cells directly, so the format below is what makes a citation render
properly on the site.

**The short version:**

```
Citation (Country, Year) | URL | Art. 6
```

Three fields, separated by a pipe `|`. Only the first is required.
One source per line — press **Alt+Enter** inside the cell for a second one.

---

## 1. The one rule that matters most

> ### Paste the URL as plain text. Never use Sheets' link tool.

If you select text and use **Insert → Link** (or Ctrl+K), or the `=HYPERLINK()`
formula, Google Sheets shows a nice blue link — but the published CSV that this
site reads contains **only the display text. The URL is silently discarded.**

You would see a perfect-looking sheet and a site with no working links.

So: type or paste the bare URL into the cell, as its own field after a `|`.
It will look plain in the sheet. That is correct.

---

## 2. The three fields

| # | Field | Required? | Example |
|---|---|---|---|
| 1 | **Citation** | Yes | `Décret n°000311/PR/MTAC (Gabon, 2011)` |
| 2 | **URL** | If you have one | `https://journal-officiel.ga/decret.pdf` |
| 3 | **Pinpoint** | If you have one | `Art. 6` |

Order doesn't matter — the parser finds the URL by its `http`, and the pinpoint by
its opening word (`Art.`, `Article`, `Section`, `§`, `Reg.`, `Rule`, `Para.`,
`Chapter`, `Schedule`, `Clause`, `Part`). Anything else is treated as the citation.

Leave a field out entirely if you don't have it — don't leave an empty `| |`.

---

## 3. What NOT to type

Two things are **derived automatically**. Typing them wastes your time and will
drift out of sync across hundreds of entries.

### Don't type "via scribd.com"
The site reads the host from the URL. If it's a third-party repository — Scribd,
archive.org, Dropbox, Google Drive, academia.edu, ResearchGate, Issuu — it
automatically appends an italic *via scribd.com* as a durability warning. If it's
an official source, it says nothing.

### Don't type the year separately
The year is read from the parentheses in your citation. Just write
`(Gabon, 2011)` or `(2024)` and it will be picked up.

---

## 4. Templates by source type

### Legislation — the common case

```
Décret n°000311/PR/MTAC (Gabon, 2011) | https://journal-officiel.ga/d.pdf | Art. 6
```

Lead with **instrument type + number + issuing country + year**. Always prefer the
official gazette or ministry site. Only fall back to Scribd or archive.org when
nothing official exists online — and when you do, the site flags it for you.

### News articles

```
Reuters, "Uganda considers boda boda licensing overhaul" (2024) | https://reuters.com/…
```

Outlet, then headline in double quotes, then year.

### NGO and institutional reports

```
FIA Foundation, "A Fare Price" (2024) | https://fiafoundation.org/…
```

Organisation, then report title in double quotes, then year. Same shape as news.

### Interviews and fieldwork — no URL

```
Interview with Paul King'ori, NTSA (Nairobi, 2024)
```

Just the citation field. The site renders it as plain text, not a broken link.

---

## 5. Multiple sources in one cell

Put each on **its own line** (Alt+Enter):

```
Traffic Act Cap. 403 (Kenya, 2012) | https://new.kenyalaw.org/… | s. 103
NTSA Regulations (Kenya, 2015) | https://new.kenyalaw.org/… | Reg. 8
```

Semicolons still work for existing entries, but new ones should use line breaks —
semicolons appear inside some legal citations and can split them in the wrong place.

---

## 6. Worked before-and-after

These are real entries from the current sheet.

| Now in the sheet | Should become |
|---|---|
| `https://new.kenyalaw.org/akn/ke/act/ln/2015/19/eng@2015-03-06` | `NTSA (Operation of Motorcycles) Regulations (Kenya, 2015) \| https://new.kenyalaw.org/akn/ke/act/ln/2015/19/eng@2015-03-06 \| Reg. 5` |
| `RURA 2019` | `RURA Regulations N°04/R/TRN-TRN/RURA/2019 (Rwanda, 2019) \| https://rura.rw/… \| Art. 13` |
| `2004/5 Law` | `Land Transport Act B.E. 2522 (Thailand, 2004) \| https://… \| s. 6/1` |
| `Indonesia-Reg.-No.-12-of-2019.pdf` | `Permenhub No. 12 of 2019 (Indonesia, 2019) \| https://peraturan.bpk.go.id/Details/104095 \| Art. 4` |
| `Annual budget` | `Finance Act (Kenya, 2024) \| https://… ` — or drop it if it can't be pinned down |

---

## 7. Where the work is

As of the current sheet, of **428 source entries**:

| Status | Count | What it means |
|---|---|---|
| Has a written citation | 231 | Fine as-is; add URL/pinpoint when convenient |
| **Bare URL, no citation** | **197** | **Renders as a hostname and is flagged "needs citation"** |
| On a third-party host | 9 | Renders with a *via …* durability flag |
| Has a pinpoint | 35 | The rest could use `Art. X` |
| Has a year | 0 | None currently parse — years aren't in parentheses yet |

The 197 are the priority. They currently render as `new.kenyalaw.org` with an
orange **needs citation** tag, which is honest but not citable by a regulator.

**To find them:** open the **Data** page, and look for the "needs citation" tag in
the Source column. The worst concentrations are **Tanzania (23), Kenya (17),
Cameroon (11), Ghana (7)**.

---

## 8. Quick reference card

```
LEGISLATION   Instrument n°X (Country, Year) | URL | Art. N
NEWS          Outlet, "Headline" (Year) | URL
REPORT        Organisation, "Title" (Year) | URL
INTERVIEW     Interview with Name, Role (Place, Year)

SEPARATOR     |  between fields      Alt+Enter  between sources
NEVER         Ctrl+K links, =HYPERLINK(), "via scribd", separate year columns
ALWAYS        plain-text URLs, official source over mirror
```
