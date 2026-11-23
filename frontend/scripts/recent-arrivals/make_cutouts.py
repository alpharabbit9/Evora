"""
Garment cut-outs for the home page's "Recent Arrivals" section.

Reads the studio photos in public/images/homepage/Recent Arrivals/ (one front and one side view
per garment, each on a near-white backdrop) and writes a transparent WebP of each garment to
public/images/homepage/recent-arrivals/<slug>-<view>.webp. The outputs are committed, so neither
the build nor CI needs Python.

The backdrop is found by flood-filling pale, unsaturated pixels inward from the photo's border,
so pale detail inside a garment (a printed logo, a highlight on leather) is never removed. The
photo's own floor shadow is dropped: the storefront draws one that follows the turn. Edge pixels
are un-mixed from the backdrop so no white fringe shows on a dark theme.

Both views of a garment are cropped to the same canvas: the same height, centred, padded to one
aspect ratio shared by every garment. Swapping side for front then changes the garment's pose,
never its size or position.

It also renders each view as a product photo for the catalog (ADR 0027): the garment on a warm
studio backdrop with a soft floor shadow, 1200 x 1500 (the product gallery's 4:5), written to
backend/scripts/catalog-import/curated/rail/photos/<slug>-<view>.webp for `npm run catalog:rail`.

  python -I frontend/scripts/recent-arrivals/make_cutouts.py

Run from the repository root. Requires numpy, scipy and Pillow. Re-run when a photo changes.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

PUBLIC = Path(__file__).resolve().parents[2] / "public" / "images" / "homepage"
SOURCE = PUBLIC / "Recent Arrivals"
OUT = PUBLIC / "recent-arrivals"
GALLERY = (
    Path(__file__).resolve().parents[3]
    / "backend" / "scripts" / "catalog-import" / "curated" / "rail" / "photos"
)
GALLERY_SIZE = (1200, 1500)
GALLERY_GARMENT_H = 0.72  # of the photo's height
GALLERY_TOP = 0.12

# slug -> (front photo, side photo).
GARMENTS: dict[str, tuple[str, str]] = {
    "forest-green-bomber": ("Forest Green Bomber Front.png", "Forest Green Bombersideview.png"),
    "black-leather-jacket": ("Jacket Catalog_ Leather Front.png", "Jacket Catalog_ Leather side.png"),
    "brown-leather-jacket": ("Brown Leather Jacket front Views.png", "Leather Jacket Side Views.png"),
    "varsity-jacket": ("Varsity Styles front.png", "Varsity Styles Side.png"),
    "mustard-hoodie": ("Mustard Hoodie Set Front.png", "Mustard Hoodie Set Sideview.png"),
    "maroon-hoodie": ("Maroon Hoodie Front .png", "Maroon Hoodie Side Views.png"),
    "green-sweatshirt": ("Green Sweatshirt Front Views.png", "Green Sweatshirt side Views.png"),
    "navy-t-shirt": ("Navy T-Shirt .png", "Navy T-Shirt Side View.png"),
}

PALE = 196  # every channel at least this bright ...
GREY = 24  # ... and channels within this of each other: a backdrop pixel
SHADOW = 135  # a floor-shadow pixel: at least this bright ...
SHADOW_GREY = 12  # ... and closer to neutral grey than the backdrop test asks
OUT_HEIGHT = 900
PAD = 0.02  # breathing room round the garment, as a fraction of its height


def garment_rgba(path: Path) -> np.ndarray:
    rgb = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    lo, hi = rgb.min(axis=2), rgb.max(axis=2)
    candidate = (lo >= PALE) & (hi - lo <= GREY)

    # Backdrop = pale pixels connected to the border.
    labels, _ = ndimage.label(candidate)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    backdrop = np.isin(labels, border[border > 0])

    # The floor shadow under a hem is darker than the backdrop but still neutral grey. Grow the
    # backdrop into neutral pixels down to SHADOW that touch it.
    shadow = (lo >= SHADOW) & (hi - lo <= SHADOW_GREY)
    labels, _ = ndimage.label(shadow)
    touching = np.unique(labels[ndimage.binary_dilation(backdrop, iterations=2) & shadow])
    backdrop |= np.isin(labels, touching[touching > 0])

    # Backdrop seen through a gap the garment encloses (inside a drawstring loop): a solid,
    # backdrop-bright patch. Thin pale detail (a logo, a letter's outline) is never solid enough.
    labels, count = ndimage.label(candidate & ~backdrop)
    for index, region in enumerate(ndimage.find_objects(labels), start=1):
        patch = labels[region] == index
        area = int(patch.sum())
        if area >= 150 and area / patch.size >= 0.2 and lo[region][patch].mean() >= 235:
            backdrop[region] |= patch

    garment = ~backdrop
    # Keep the garment itself: the largest blob, with its holes filled (except an enclosed
    # pale patch found above stays backdrop).
    labels, count = ndimage.label(garment)
    if count == 0:
        raise ValueError(f"no garment found in {path.name}")
    sizes = ndimage.sum(garment, labels, range(1, count + 1))
    garment = labels == (int(np.argmax(sizes)) + 1)
    garment = ndimage.binary_fill_holes(garment & ~backdrop) & ~backdrop
    # Shave the one-pixel ring of mixed backdrop, then soften the edge.
    garment = ndimage.binary_erosion(garment, iterations=1)
    alpha = ndimage.gaussian_filter(garment.astype(np.float32), sigma=0.9)
    alpha = np.clip((alpha - 0.15) / 0.85, 0.0, 1.0)

    # Un-mix the backdrop from partly transparent edge pixels: C = a*F + (1-a)*W.
    white = np.median(rgb[backdrop], axis=0) if backdrop.any() else np.array([255.0] * 3)
    a = alpha[..., None]
    with np.errstate(divide="ignore", invalid="ignore"):
        fg = np.where(a > 0.02, (rgb - (1 - a) * white) / a, 0)
    fg = np.clip(fg, 0, 255)
    return np.dstack([fg, alpha * 255]).astype(np.uint8)


def bbox(rgba: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(rgba[..., 3] > 8)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def studio_photo(garment: np.ndarray) -> Image.Image:
    """The cropped garment, centred on a lit backdrop, standing over a soft floor shadow."""
    width, height = GALLERY_SIZE
    # Backdrop: warm ivory, a little lighter behind the garment and darker towards the floor.
    ys, xs = np.mgrid[0:height, 0:width].astype(np.float32)
    top, bottom = np.array([246, 244, 239], np.float32), np.array([233, 229, 221], np.float32)
    shade = (ys / height)[..., None]
    backdrop = top * (1 - shade) + bottom * shade
    glow = np.exp(-(((xs - width / 2) / (width * 0.42)) ** 2 + ((ys - height * 0.45) / (height * 0.4)) ** 2))
    backdrop = np.clip(backdrop + glow[..., None] * 8, 0, 255)
    photo = Image.fromarray(backdrop.astype(np.uint8), "RGB").convert("RGBA")

    h, w = garment.shape[:2]
    target_h = round(height * GALLERY_GARMENT_H)
    scale = target_h / h
    if w * scale > width * 0.86:  # a very wide piece fits by width instead
        scale = width * 0.86 / w
    piece = Image.fromarray(garment, "RGBA").resize(
        (max(1, round(w * scale)), max(1, round(h * scale))), Image.LANCZOS
    )
    x = (width - piece.width) // 2
    y = round(height * GALLERY_TOP) + (target_h - piece.height)

    # Floor shadow: a blurred ellipse just under the hem, as wide as most of the garment.
    floor = np.zeros((height, width), np.float32)
    cx, cy = width / 2, y + piece.height + height * 0.012
    rx, ry = piece.width * 0.42, height * 0.018
    floor[((xs - cx) / rx) ** 2 + ((ys - cy) / ry) ** 2 <= 1] = 1
    floor = ndimage.gaussian_filter(floor, sigma=height * 0.012) * 0.32
    # Contact shade: the garment's own silhouette, blurred, offset down a touch.
    alpha = np.zeros((height, width), np.float32)
    alpha[y : y + piece.height, x : x + piece.width] = np.asarray(piece)[..., 3] / 255
    contact = ndimage.shift(ndimage.gaussian_filter(alpha, sigma=height * 0.01), (height * 0.008, 0)) * 0.18
    darken = np.clip(floor + contact, 0, 0.5)[..., None]
    rgb = np.asarray(photo)[..., :3].astype(np.float32) * (1 - darken)
    photo = Image.fromarray(rgb.astype(np.uint8), "RGB").convert("RGBA")
    photo.alpha_composite(piece, (x, y))
    return photo.convert("RGB")


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    GALLERY.mkdir(parents=True, exist_ok=True)
    cut: dict[str, dict[str, np.ndarray]] = {}
    for slug, (front, side) in GARMENTS.items():
        cut[slug] = {}
        for view, name in (("front", front), ("side", side)):
            rgba = garment_rgba(SOURCE / name)
            x0, y0, x1, y1 = bbox(rgba)
            cut[slug][view] = rgba[y0:y1, x0:x1]

    # One canvas aspect for every garment and view: the widest crop decides it.
    aspect = max(img.shape[1] / img.shape[0] for views in cut.values() for img in views.values())
    aspect *= 1 + 2 * PAD
    print(f"canvas aspect {aspect:.3f} (width / height)")

    for slug, views in cut.items():
        for view, img in views.items():
            h, w = img.shape[:2]
            target_h = round(OUT_HEIGHT * (1 - 2 * PAD))
            scale = target_h / h
            garment = Image.fromarray(img, "RGBA").resize(
                (max(1, round(w * scale)), target_h), Image.LANCZOS
            )
            canvas = Image.new("RGBA", (round(OUT_HEIGHT * aspect), OUT_HEIGHT), (0, 0, 0, 0))
            canvas.alpha_composite(
                garment, ((canvas.width - garment.width) // 2, round(OUT_HEIGHT * PAD))
            )
            path = OUT / f"{slug}-{view}.webp"
            canvas.save(path, "WEBP", quality=86, method=4)
            print(f"{path.name}: {canvas.width}x{canvas.height}, {path.stat().st_size // 1024} KB")

            photo_path = GALLERY / f"{slug}-{view}.webp"
            studio_photo(img).save(photo_path, "WEBP", quality=88, method=4)
            print(f"  photo {photo_path.name}: {photo_path.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
