# ADR 0017 — Recent Arrivals Clothes Rail

- **Status:** Amended by [ADR 0027](0027-recent-arrivals-turntable.md) (2026-11-16): the rail
  stays, but hangs curated pieces with real side and front photos instead of catalog cut-outs.
  Decisions 1–2 (`CUTOUT` images, `GET /products/arrivals`) stand. Recorded retrospectively; the
  code cited this ADR before the record existed.
- **Checked against the code 2026-11-18 (plan.md 10.3):**
  - Decisions 1–2 hold. The endpoint is still served, but the storefront no longer calls it
    (`fetchArrivals` has no caller).
  - Decision 3 no longer holds: the rail is the static, curated list in `arrivals-data.ts`
    (ADR 0027, decision 2), so it has no loading, error or empty state.
  - Decision 4: CSS still owns the rail's motion, but the layers are ADR 0027's. `.arrival-sway`,
    `.arrival-cutout` and `.arrival-label` remain; `.arrival-turn` is gone.
  - Decisions 5 (input parity) and 6 (reduced motion) hold. The reduced-motion hint now reads
    "Select a piece to shop it".
- **Date:** 2026-11-16
- **Related:** [ADR 0010](0010-motion-framer-and-gsap-ownership.md) (motion ownership),
  [ADR 0012](0012-public-catalog-api-and-cart-ownership.md) (public catalog API),
  [ADR 0013](0013-featured-dark-edit.md) (the featured section below it)

## Context
The home page needed a "Recent Arrivals" section that was more than a second product grid: the
Dark Edit grid sits directly below it. The chosen concept is a clothes rail. The newest pieces
hang side-on on a rod, and each turns to face the front when pointed at, the way a customer pulls
a hanger out of a rack. Drawing garments that way needs an image of the garment alone, on a
transparent background, which the listing photos are not.

## Decision
1. **A second kind of product image.** `ProductImage.kind` is `PHOTO` (the listing card and the
   gallery) or `CUTOUT` (the garment alone on a transparent background). A partial unique index
   allows at most one `CUTOUT` per product. A cut-out is drawn only by the rail. It never
   appears in the gallery and is never the card image. It does not satisfy the publication rule,
   so a product still needs a photo to be public.
2. **A read-only endpoint.** `GET /api/v1/products/arrivals?limit=` (default 8, max 12) returns
   the newest public products that have a cut-out, newest first (`publishedAt`, then
   `createdAt`). Each item is a listing card plus its `cutout` image view. It runs two short
   reads (cards, then their cut-outs) and drops a product whose cut-out vanished between them.
   The full publication rule applies, so the rail never shows a product the catalog would hide.
   The route is registered before `/products/:slug`.
3. **The rail is a window onto the catalog**, not a hand-kept list. The storefront fetches 8
   (`ArrivalsRail`, React Query key `catalog.arrivals(8)`), with loading (rail silhouette),
   error (retry) and empty ("being restocked") states.
4. **CSS owns all of the rail's motion** (ADR 0010). Each moving layer is its own element or
   property, so no two rules write the same `transform`. The rules are in `globals.css`:
   - `.arrival-sway` owns the idle sway (`rotate`) and the slide aside for a turned neighbour
     (`translate`);
   - `.arrival-turn` owns side-on to front (`transform: perspective() rotateY()`) and the
     shading (`filter`);
   - `.arrival-cutout` owns the side-on edge that suggests the garment's thickness (`filter`, via
     `--edge`);
   - `.arrival-label` owns the name and price.

   Slots never change width: a turned garment grows around its centre while its neighbours slide
   away, so nothing moves out from under the pointer. Per-garment custom properties set the
   sizes: `--ratio` (the cut-out's aspect ratio), `--length` (a coat hangs lower than a jacket)
   and `--i` (sway phase).
5. **Input parity.**
   - A garment turns on hover (only on pointers that can hover), on keyboard focus, and on a
     touch screen's first tap (`data-turned`). A second tap opens the product.
   - A mouse click or Enter opens it at once.
   - Each garment is one link, labelled by its category, name and price.
6. **Reduced motion.** No turning, swaying or sliding. Garments hang facing the front at a
   smaller size with room between them, each with its name and price always shown (nothing turns
   to reveal them). The hint reads "Select a piece to view it".

## Amendment — 2026-11-16 (plan.md Phase 4)
> **Superseded the same day.** The product owner chose the Recent Arrivals turntable (ADR 0027),
> which replaced this rail. The points below record the rail as Phase 4 left it; the code is gone.

- **Side angle −62°** (was −76°), so a side-on garment reads as hung rather than as a sliver.
- **Thickness edge.** A hard-edged, offset copy of the cut-out's silhouette (`drop-shadow` with
  no blur, offset `--edge`) on its near side reads as the garment's shaded edge once foreshortened.
  It slides back to 0px as the garment faces front. A pseudo-element was rejected: a rectangle
  cannot follow the cut-out's contour and would show around the garment.
- **Slots scale with the rod.** `.arrival` is `max(30% of the garment, 75cqi / --count)`, with
  `container-type: inline-size` on `.arrivals-rail`, so on a wide screen the garments span about
  three quarters of the rod instead of bunching in its middle. Phones keep the side-on minimum and
  scroll.
- **Height from the actual garments.** The component sets `--count` and `--max-length` (the
  longest `--length` on the rail) on the list; its height is the hook, the longest garment (times
  `--rest-scale`, now set on the rail so it applies under reduced motion), and the label room. A
  jacket-only rail no longer reserves a coat's height.
- **The heading row reveals** with `RevealGroup`, like every other section. Only the heading and
  the link are `RevealItem`s; the garments stay CSS-owned.

## Consequences
- Catalog import (`backend/scripts/catalog-import`) must supply cut-outs for products meant to
  hang on the rail. A product without one simply does not appear there.
- The side-on default hides the products until a visitor interacts. The rail trades information
  density for a memorable moment, which is acceptable because the grid below shows products
  plainly.
- Eight infinite CSS sway animations run while the page is open. The homepage plan (`plan.md`,
  Phase 5) pauses them off-screen.

## Alternatives
- **A second product grid or carousel.** It would repeat the Dark Edit directly below it.
- **Using the listing photo on the rail.** Backgrounds and framing differ per photo, so garments
  would not read as hanging on one rod.
- **WebGL garments.** More convincing fabric, but a large dependency for one section. The CSS
  version is the baseline, and a WebGL prototype is an optional, gated experiment in `plan.md`
  Phase 6.
