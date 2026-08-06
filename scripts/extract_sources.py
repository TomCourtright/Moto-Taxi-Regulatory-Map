"""Extract source URLs and non-URL references from the Regulations CSV.

Country blocks are 4 rows: Written / Enforced / Source / Notes.
The Source row contains either full URLs, plain-text document names, or a mix.
Topic columns start at index 3; column 2 holds the row-type indicator.

Outputs:
  data/sources.json    - one entry per unique URL, with all (country, topic) contexts
  data/non_url_refs.csv - source cells that are not URLs (need lookup)
  data/extraction_summary.txt - human-readable summary
"""
from __future__ import annotations

import csv
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "Regulations (Static - July 21).csv"
OUT_DIR = ROOT / "data"
OUT_DIR.mkdir(exist_ok=True)

URL_RE = re.compile(r"https?://[^\s\"'<>()\[\]]+")


def strip_url_trailing(u: str) -> str:
    # Strip common trailing punctuation that isn't part of the URL
    while u and u[-1] in ".,);:":
        u = u[:-1]
    return u


def load_rows() -> list[list[str]]:
    with CSV_PATH.open(encoding="utf-8", errors="replace", newline="") as f:
        return list(csv.reader(f))


def find_topic_headers(rows: list[list[str]]) -> list[str]:
    # Row index 1 (2nd row) holds the specific topic per column
    if len(rows) < 2:
        return []
    return rows[1]


def iter_country_blocks(rows: list[list[str]]):
    """Yield (country, block_rows) where block_rows is the 4 rows in order."""
    i = 0
    current_country = None
    while i < len(rows):
        row = rows[i]
        col2 = row[2].strip() if len(row) > 2 else ""
        if col2 == "Written":
            country = row[0].strip() if row and row[0].strip() else current_country
            if row[0].strip():
                current_country = row[0].strip()
            # Look ahead for the block (up to next "Written" or EOF)
            block = [row]
            j = i + 1
            while j < len(rows):
                nxt = rows[j]
                nxt_c2 = nxt[2].strip() if len(nxt) > 2 else ""
                if nxt_c2 == "Written":
                    break
                block.append(nxt)
                j += 1
            yield country, block
            i = j
        else:
            i += 1


def source_row_of(block: list[list[str]]) -> list[str] | None:
    for r in block:
        if len(r) > 2 and r[2].strip() == "Source":
            return r
    return None


def main() -> int:
    rows = load_rows()
    headers = find_topic_headers(rows)

    # url -> list of (country, topic, raw_cell)
    url_contexts: dict[str, list[dict]] = defaultdict(list)
    # (country, topic, cell) for non-URL source references
    non_url_refs: list[dict] = []

    for country, block in iter_country_blocks(rows):
        src = source_row_of(block)
        if not src or not country:
            continue
        for col_idx in range(3, len(src)):
            cell = src[col_idx].strip()
            if not cell:
                continue
            topic = headers[col_idx].strip() if col_idx < len(headers) else f"col{col_idx}"
            urls_in_cell = [strip_url_trailing(u) for u in URL_RE.findall(cell)]
            if urls_in_cell:
                for u in urls_in_cell:
                    url_contexts[u].append({
                        "country": country,
                        "topic": topic,
                        "cell": cell,
                    })
            else:
                # Plain-text source reference (document name, law citation)
                non_url_refs.append({
                    "country": country,
                    "topic": topic,
                    "reference": cell,
                })

    # Sort URLs for stable output
    sources = []
    for url in sorted(url_contexts):
        ctxs = url_contexts[url]
        countries = sorted({c["country"] for c in ctxs})
        topics = sorted({c["topic"] for c in ctxs})
        sources.append({
            "url": url,
            "countries": countries,
            "topics": topics,
            "reference_count": len(ctxs),
            "contexts": ctxs,
        })

    (OUT_DIR / "sources.json").write_text(
        json.dumps(sources, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    # Non-URL refs -> CSV, dedup on (country, reference)
    seen = set()
    deduped = []
    for r in non_url_refs:
        key = (r["country"], r["reference"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(r)
    deduped.sort(key=lambda r: (r["country"], r["reference"]))

    with (OUT_DIR / "non_url_refs.csv").open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["country", "topic", "reference"])
        w.writeheader()
        w.writerows(deduped)

    summary_lines = [
        f"Rows in CSV:                      {len(rows)}",
        f"Country blocks detected:          {sum(1 for _ in iter_country_blocks(rows))}",
        f"Unique URLs:                      {len(sources)}",
        f"Total URL references (with dupes): {sum(s['reference_count'] for s in sources)}",
        f"Non-URL source references (deduped): {len(deduped)}",
        "",
        "Countries with URLs:",
    ]
    country_url_count: dict[str, int] = defaultdict(int)
    for s in sources:
        for c in s["countries"]:
            country_url_count[c] += 1
    for c in sorted(country_url_count):
        summary_lines.append(f"  {c}: {country_url_count[c]}")

    (OUT_DIR / "extraction_summary.txt").write_text(
        "\n".join(summary_lines),
        encoding="utf-8",
    )
    print("\n".join(summary_lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
