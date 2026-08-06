"""Download every URL from data/sources.json and produce an inventory.

Saves files under: documents/<primary_country>/<slug>.<ext>
Detects content type from response headers + magic bytes (real content, not extension).
Idempotent: skips URLs already downloaded (uses data/inventory.json as the ledger).

Run:
    python scripts/download_sources.py            # download all
    python scripts/download_sources.py --retry-failed   # only re-try prior failures
    python scripts/download_sources.py --limit 5  # smoke test
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import json
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import requests

ROOT = Path(__file__).resolve().parent.parent
SOURCES_JSON = ROOT / "data" / "sources.json"
INVENTORY_JSON = ROOT / "data" / "inventory.json"
DOCS_DIR = ROOT / "documents"
DOCS_DIR.mkdir(exist_ok=True)

TIMEOUT = 45
MAX_BYTES = 200 * 1024 * 1024  # 200 MB per file cap
WORKERS = 6

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

SLUG_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def slugify_from_url(url: str) -> str:
    parsed = urlparse(url)
    # Prefer the last non-empty path segment
    path = unquote(parsed.path or "").rstrip("/")
    tail = path.rsplit("/", 1)[-1] if path else parsed.netloc
    tail = tail or parsed.netloc
    # Strip extension for now — we'll append the detected one later
    if "." in tail:
        stem, _, _ = tail.rpartition(".")
        if stem:
            tail = stem
    slug = SLUG_RE.sub("-", tail).strip("-")
    if not slug:
        slug = "doc"
    # Cap length; append short hash for uniqueness across similar names
    if len(slug) > 80:
        slug = slug[:80].rstrip("-")
    h = hashlib.sha1(url.encode("utf-8")).hexdigest()[:8]
    return f"{slug}-{h}"


def sanitize_folder(name: str) -> str:
    return SLUG_RE.sub("-", name).strip("-") or "unknown"


def detect_kind(content: bytes, content_type: str, final_url: str) -> str:
    """Return one of: pdf, html, doc, docx, xls, xlsx, image, text, other."""
    head = content[:8]
    if head.startswith(b"%PDF-"):
        return "pdf"
    if head[:2] == b"PK":  # zip container: docx/xlsx/pptx
        ct = content_type.lower()
        if "wordprocessingml" in ct or ".docx" in final_url.lower():
            return "docx"
        if "spreadsheetml" in ct or ".xlsx" in final_url.lower():
            return "xlsx"
        return "zip"
    if head.startswith(b"\xd0\xcf\x11\xe0"):
        return "doc"  # legacy Office
    if head[:3] in (b"\xff\xd8\xff",) or head[:8].startswith(b"\x89PNG"):
        return "image"
    lowered = content[:2048].lower()
    if b"<!doctype html" in lowered or b"<html" in lowered:
        return "html"
    ct = content_type.lower()
    if "pdf" in ct:
        return "pdf"
    if "html" in ct or "xhtml" in ct:
        return "html"
    if "text" in ct:
        return "text"
    return "other"


EXT_FOR_KIND = {
    "pdf": ".pdf",
    "html": ".html",
    "doc": ".doc",
    "docx": ".docx",
    "xls": ".xls",
    "xlsx": ".xlsx",
    "image": ".img",
    "text": ".txt",
    "zip": ".zip",
    "other": ".bin",
}


def pdf_metadata(path: Path) -> dict:
    try:
        from pypdf import PdfReader
        r = PdfReader(str(path))
        n = len(r.pages)
        # Sample first 3 pages for text vs scanned detection
        text_len = 0
        for p in r.pages[: min(3, n)]:
            try:
                text_len += len(p.extract_text() or "")
            except Exception:
                pass
        return {
            "page_count": n,
            "extractable_text_sample_chars": text_len,
            "likely_scanned": text_len < 50 and n > 0,
        }
    except Exception as e:
        return {"pdf_parse_error": str(e)}


def download_one(entry: dict) -> dict:
    url: str = entry["url"]
    countries: list[str] = entry.get("countries", []) or ["unknown"]
    primary = sorted(countries)[0]
    result: dict[str, Any] = {
        "url": url,
        "countries": countries,
        "topics": entry.get("topics", []),
        "reference_count": entry.get("reference_count", 0),
        "primary_country": primary,
    }
    try:
        try:
            r = requests.get(
                url, headers=HEADERS, timeout=TIMEOUT,
                allow_redirects=True, stream=True,
            )
        except requests.exceptions.SSLError:
            # Fallback for gov sites with broken/expired certs (public legal docs, read-only)
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            r = requests.get(
                url, headers=HEADERS, timeout=TIMEOUT,
                allow_redirects=True, stream=True, verify=False,
            )
            result["ssl_bypassed"] = True
        result["http_status"] = r.status_code
        result["final_url"] = r.url
        result["content_type"] = r.headers.get("Content-Type", "")
        if r.status_code >= 400:
            result["status"] = "http_error"
            r.close()
            return result
        # Stream up to MAX_BYTES
        chunks = []
        total = 0
        for chunk in r.iter_content(65536):
            if not chunk:
                continue
            total += len(chunk)
            if total > MAX_BYTES:
                result["status"] = "too_large"
                result["bytes_when_aborted"] = total
                r.close()
                return result
            chunks.append(chunk)
        r.close()
        content = b"".join(chunks)
        result["bytes"] = len(content)
        kind = detect_kind(content, result["content_type"], result["final_url"])
        result["kind"] = kind
        ext = EXT_FOR_KIND.get(kind, ".bin")

        folder = DOCS_DIR / sanitize_folder(primary)
        folder.mkdir(parents=True, exist_ok=True)
        filename = slugify_from_url(url) + ext
        dest = folder / filename
        dest.write_bytes(content)
        result["saved_to"] = str(dest.relative_to(ROOT)).replace("\\", "/")

        if kind == "pdf":
            result.update(pdf_metadata(dest))

        result["status"] = "ok"
    except requests.exceptions.SSLError as e:
        result["status"] = "ssl_error"
        result["error"] = str(e)[:400]
    except requests.exceptions.Timeout:
        result["status"] = "timeout"
    except requests.exceptions.ConnectionError as e:
        result["status"] = "connection_error"
        result["error"] = str(e)[:400]
    except Exception as e:
        result["status"] = "error"
        result["error"] = f"{type(e).__name__}: {e}"[:400]
    return result


def load_existing_inventory() -> dict[str, dict]:
    if not INVENTORY_JSON.exists():
        return {}
    try:
        data = json.loads(INVENTORY_JSON.read_text(encoding="utf-8"))
        return {e["url"]: e for e in data}
    except Exception:
        return {}


def save_inventory(entries: list[dict]) -> None:
    entries_sorted = sorted(entries, key=lambda e: (e.get("primary_country", ""), e["url"]))
    INVENTORY_JSON.write_text(
        json.dumps(entries_sorted, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--retry-failed", action="store_true")
    ap.add_argument("--workers", type=int, default=WORKERS)
    args = ap.parse_args()

    sources = json.loads(SOURCES_JSON.read_text(encoding="utf-8"))
    existing = load_existing_inventory()

    to_fetch: list[dict] = []
    for src in sources:
        prev = existing.get(src["url"])
        if prev and prev.get("status") == "ok" and not args.retry_failed:
            continue
        if args.retry_failed and prev and prev.get("status") == "ok":
            continue
        to_fetch.append(src)

    if args.limit:
        to_fetch = to_fetch[: args.limit]

    print(f"Sources total: {len(sources)}  |  to fetch: {len(to_fetch)}  |  workers: {args.workers}")

    results: dict[str, dict] = dict(existing)
    completed = 0
    start = time.time()
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(download_one, src): src for src in to_fetch}
        for fut in cf.as_completed(futures):
            src = futures[fut]
            try:
                res = fut.result()
            except Exception as e:
                res = {"url": src["url"], "status": "worker_error", "error": str(e)}
            results[res["url"]] = res
            completed += 1
            marker = {
                "ok": "OK",
                "http_error": "HTTP",
                "timeout": "TIME",
                "ssl_error": "SSL ",
                "connection_error": "CONN",
                "too_large": "BIG ",
            }.get(res.get("status", ""), "ERR ")
            print(f"[{completed:3d}/{len(to_fetch)}] {marker} {res.get('kind','?'):>4}  {res['url'][:100]}")
            # Persist incrementally every 10
            if completed % 10 == 0:
                save_inventory(list(results.values()))

    save_inventory(list(results.values()))
    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.0f}s. Inventory: {INVENTORY_JSON}")

    # Quick summary
    by_status: dict[str, int] = {}
    for r in results.values():
        by_status[r.get("status", "unknown")] = by_status.get(r.get("status", "unknown"), 0) + 1
    print("Status counts:", by_status)
    return 0


if __name__ == "__main__":
    sys.exit(main())
