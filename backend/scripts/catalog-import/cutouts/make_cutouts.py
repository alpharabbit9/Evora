"""
Garment cut-outs for the home page's "Recent Arrivals" rail (ADR 0017).

Turns each arrival's source photo (an Unsplash photo of one garment on a hanger, cached by the
importer under <CATALOG_DATA_DIR>/arrivals/images/<photoId>.jpg) into a transparent WebP of the
garment alone, written to scripts/catalog-import/curated/arrivals/cutouts/<photoId>.webp. Those
files are committed: the importer reads them, so neither it nor CI needs Python.

Segmentation is OpenCV GrabCut seeded by a hand-picked box per photo (below the photo's own
hanger hook, which the storefront draws itself) plus optional background polygons, then a
guided filter on the full-size photo for soft edges. No model download; deterministic for a
given OpenCV version. Re-run only when a photo or its box changes, and check the previews.

  python -I scripts/catalog-import/cutouts/make_cutouts.py <images dir> [--preview <dir>]

Run from backend/. Requires numpy, Pillow and opencv-contrib-python (for cv2.ximgproc).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

OUT_DIR = Path(__file__).resolve().parent.parent / "curated" / "arrivals" / "cutouts"

# Fractions of the photo's width/height. `box` must contain the whole garment and nothing of the
# hanger hook; `background` polygons are forced to background (an arm, a neighbouring object);
# `shrink` erodes the mask by that many working-size pixels where a pale halo of backdrop clings.
# Photos tried and dropped: a black-check flannel on black (its black squares read as backdrop)
# and a white puffer in a shop window (reflections), neither separable by GrabCut.
PHOTOS: dict[str, dict] = {
    "1702026672242-c79a52996dd4": {"box": (0.20, 0.072, 0.74, 0.445)},
    "1591047139829-d91aecb6caea": {
        "box": (0.04, 0.215, 0.93, 0.945),
        "background": [[(0.60, 0.0), (1.0, 0.0), (1.0, 0.44), (0.88, 0.36), (0.66, 0.17)]],
    },
    "1611312449408-fcece27cdbb7": {"box": (0.03, 0.165, 0.975, 0.795)},
    "1667283831517-5b747b3c17c8": {"box": (0.19, 0.27, 0.82, 0.935)},
    "1565532070333-43edd7d75c90": {
        "box": (0.11, 0.075, 0.80, 0.735),
        "background": [[(0.74, 0.0), (1.0, 0.0), (1.0, 0.75), (0.79, 0.75), (0.79, 0.30)]],
    },
    "1649937408746-4d2f603f91c8": {"box": (0.14, 0.11, 0.89, 0.93)},
    "1587374835498-3039ff123c05": {"box": (0.36, 0.165, 0.73, 0.625)},
    "1624548140150-108c3287f551": {"box": (0.18, 0.13, 0.92, 0.835), "shrink": 5},
}

WORK_MAX_SIDE = 1000  # GrabCut runs on a downscaled copy; edges are refined at full size.
OUT_MAX_HEIGHT = 1400


def cut_out(photo: Path, spec: dict) -> Image.Image:
    full = cv2.imread(str(photo), cv2.IMREAD_COLOR)
    if full is None:
        raise ValueError(f"cannot read {photo}")
    height, width = full.shape[:2]
    scale = WORK_MAX_SIDE / max(height, width)
    small = cv2.resize(full, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA)
    sh, sw = small.shape[:2]

    x0, y0, x1, y1 = spec["box"]
    mask = np.full((sh, sw), cv2.GC_BGD, np.uint8)
    mask[round(y0 * sh) : round(y1 * sh), round(x0 * sw) : round(x1 * sw)] = cv2.GC_PR_FGD
    for polygon in spec.get("background", []):
        points = np.array([(round(x * sw), round(y * sh)) for x, y in polygon], np.int32)
        cv2.fillPoly(mask, [points], cv2.GC_BGD)

    bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
    cv2.grabCut(small, mask, None, bgd, fgd, 8, cv2.GC_INIT_WITH_MASK)
    hard = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

    # Keep the garment (the largest blob), drop specks, close pinholes.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    hard = cv2.morphologyEx(hard, cv2.MORPH_OPEN, kernel)
    hard = cv2.morphologyEx(hard, cv2.MORPH_CLOSE, kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(hard)
    if count > 1:
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        hard = np.where(labels == largest, 255, 0).astype(np.uint8)
    if spec.get("shrink"):
        hard = cv2.erode(hard, kernel, iterations=spec["shrink"])

    # Soft edges: upscale, then a guided filter steered by the full-size photo.
    alpha = cv2.resize(hard, (width, height), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255
    guide = cv2.cvtColor(full, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255
    alpha = cv2.ximgproc.guidedFilter(guide, alpha, 6, 1e-3)
    alpha = np.clip((alpha - 0.08) / 0.84, 0, 1)

    rgba = np.dstack([cv2.cvtColor(full, cv2.COLOR_BGR2RGB), (alpha * 255).astype(np.uint8)])
    image = Image.fromarray(rgba, "RGBA")
    bbox = image.getchannel("A").point(lambda a: 255 if a > 12 else 0).getbbox()
    if bbox is None:
        raise ValueError(f"empty cut-out for {photo.name}")
    pad = round(0.01 * max(width, height))
    image = image.crop((max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(width, bbox[2] + pad), min(height, bbox[3] + pad)))
    if image.height > OUT_MAX_HEIGHT:
        image = image.resize((round(image.width * OUT_MAX_HEIGHT / image.height), OUT_MAX_HEIGHT), Image.LANCZOS)
    return image


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("images", type=Path, help="directory of cached source photos (<photoId>.jpg)")
    parser.add_argument("--preview", type=Path, help="also write each cut-out over grey, as JPEG, here")
    parser.add_argument("--only", nargs="*", help="photo ids to (re)build; default all")
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    if args.preview:
        args.preview.mkdir(parents=True, exist_ok=True)
    for photo_id, spec in PHOTOS.items():
        if args.only and photo_id not in args.only:
            continue
        image = cut_out(args.images / f"{photo_id}.jpg", spec)
        target = OUT_DIR / f"{photo_id}.webp"
        image.save(target, "WEBP", quality=86, method=6)
        print(f"{photo_id}: {image.width}x{image.height}, {target.stat().st_size // 1024} KiB")
        if args.preview:
            backdrop = Image.new("RGB", image.size, (128, 128, 128))
            backdrop.paste(image, mask=image.getchannel("A"))
            backdrop.save(args.preview / f"{photo_id}.jpg", quality=80)
    return 0


if __name__ == "__main__":
    sys.exit(main())
