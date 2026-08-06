"""Compress only the PDFs that actually need it. PRD.md §6.

    python scripts/compress_pdfs.py              # compress anything over 10 MB
    python scripts/compress_pdfs.py --dry-run    # report what would happen
    python scripts/compress_pdfs.py --threshold-mb 5

Why a threshold rather than compressing everything: for a regulator audience the
PDF *is* the primary source. Recompression is a lossy round-trip that can soften
scanned text, so we pay that cost only where file size is a real problem.

Originals are never destroyed in place — a compressed file is only swapped in if
it is meaningfully smaller, and the original is kept alongside as
`<name>.original.pdf` until you delete it yourself.

Pure pypdf, no Ghostscript/qpdf needed:
  1. lossless — deduplicate objects and recompress content streams
  2. if still over the threshold, downsample embedded images

Scanned PDFs (no extractable text layer) are reported but NOT image-downsampled,
because for those the images *are* the text.
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = ROOT / "documents"

MB = 1024 * 1024


def has_text_layer(path: Path) -> bool:
    try:
        from pypdf import PdfReader
        r = PdfReader(str(path))
        chars = 0
        for p in r.pages[: min(3, len(r.pages))]:
            try:
                chars += len(p.extract_text() or "")
            except Exception:
                pass
        return chars >= 50
    except Exception:
        return True  # assume text; safer than mangling images


def compress(path: Path, threshold: int, image_quality: int) -> tuple[bool, str]:
    """Return (wrote_smaller_file, message)."""
    from pypdf import PdfReader, PdfWriter

    before = path.stat().st_size
    tmp = path.with_suffix(".compressed.tmp")

    try:
        writer = PdfWriter(clone_from=str(path))

        # Pass 1 — lossless.
        for page in writer.pages:
            try:
                page.compress_content_streams()
            except Exception:
                pass
        try:
            writer.compress_identical_objects()
        except Exception:
            pass

        with open(tmp, "wb") as fh:
            writer.write(fh)
        after = tmp.stat().st_size

        # Pass 2 — lossy image downsample, only if lossless was not enough and
        # the document has a real text layer to fall back on.
        if after > threshold and has_text_layer(path):
            writer2 = PdfWriter(clone_from=str(path))
            touched = 0
            for page in writer2.pages:
                try:
                    for img in page.images:
                        img.replace(img.image, quality=image_quality)
                        touched += 1
                except Exception:
                    pass
            if touched:
                for page in writer2.pages:
                    try:
                        page.compress_content_streams()
                    except Exception:
                        pass
                tmp2 = path.with_suffix(".compressed2.tmp")
                with open(tmp2, "wb") as fh:
                    writer2.write(fh)
                if tmp2.stat().st_size < after:
                    tmp.unlink(missing_ok=True)
                    tmp2.replace(tmp)
                    after = tmp.stat().st_size
                else:
                    tmp2.unlink(missing_ok=True)

        # Only accept a real win. A 2% saving is not worth a lossy round-trip.
        if after < before * 0.9:
            keep = path.with_name(path.stem + ".original.pdf")
            if not keep.exists():
                shutil.copy2(path, keep)
            tmp.replace(path)
            pct = 100 * (1 - after / before)
            return True, f"{before/MB:.1f} MB -> {after/MB:.1f} MB  (-{pct:.0f}%)  original kept as {keep.name}"

        tmp.unlink(missing_ok=True)
        return False, f"{before/MB:.1f} MB — no useful saving, left alone"

    except Exception as e:
        tmp.unlink(missing_ok=True)
        Path(str(path.with_suffix('.compressed2.tmp'))).unlink(missing_ok=True)
        return False, f"FAILED: {type(e).__name__}: {e}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--threshold-mb", type=float, default=10.0,
                    help="only compress PDFs larger than this (default 10)")
    ap.add_argument("--image-quality", type=int, default=60,
                    help="JPEG quality for the lossy pass (default 60)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    threshold = int(args.threshold_mb * MB)

    if not DOCS_DIR.exists():
        print(f"No documents/ directory at {DOCS_DIR}")
        return 0

    pdfs = [p for p in DOCS_DIR.rglob("*.pdf") if not p.name.endswith(".original.pdf")]
    oversized = [p for p in pdfs if p.stat().st_size > threshold]

    print(f"{len(pdfs)} PDF(s) in documents/  |  {len(oversized)} over {args.threshold_mb:g} MB")

    if not oversized:
        print("Nothing to compress.")
        return 0

    for p in sorted(oversized, key=lambda x: -x.stat().st_size):
        rel = p.relative_to(ROOT)
        size = p.stat().st_size / MB
        if args.dry_run:
            tag = "" if has_text_layer(p) else "  [scanned — lossless only]"
            print(f"  WOULD COMPRESS  {size:6.1f} MB  {rel}{tag}")
            continue
        print(f"  {rel}")
        _, msg = compress(p, threshold, args.image_quality)
        print(f"      {msg}")

    if not args.dry_run:
        print("\nRe-run `node scripts/build-documents.mjs` to refresh the manifest sizes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
