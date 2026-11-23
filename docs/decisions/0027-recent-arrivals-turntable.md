# ADR 0027 — Recent Arrivals Rail With Real Side and Front Views

- **Status:** Accepted
- **Date:** 2026-11-16
- **Amends:** [ADR 0017](0017-recent-arrivals-clothes-rail.md). The clothes-rail concept stays.
  The garments, their data source and the turn change. ADR 0017's backend decisions (`CUTOUT`
  images, `GET /products/arrivals`) stand.
- **Related:** [ADR 0010](0010-motion-framer-and-gsap-ownership.md) (motion ownership),
  [ADR 0026](0026-unconfirmed-storefront-content.md) (no unbacked claims on the storefront)

## Context
The rail hung one cut-out per product and faked the side-on pose by rotating it in CSS, so the
garments read as flat cards seen at an angle. The owner supplied studio photos of 8 garments,
each shot from the side and from the front on a white backdrop, in
`frontend/public/images/homepage/Recent Arrivals/`. They asked for the rail to look like a
shop rail, with the garments hanging side-on, gaps between them, and a rod only a little
longer than they need. Hovering one should turn it smoothly to the front, and leaving should
turn it back.

A first attempt replaced the rail with a row of product cards. The owner rejected it: the rail
was right, only the garments were wrong.

## Decision
1. **Real views, cut out offline.** `frontend/scripts/recent-arrivals/make_cutouts.py`
   (numpy, scipy, Pillow) removes each photo's backdrop:
   - It flood-fills pale pixels from the border, then grows into the neutral-grey floor shadow.
   - It clears backdrop-bright patches the garment encloses.
   - It un-mixes the edge pixels.

   It writes `public/images/homepage/recent-arrivals/<slug>-{side,front}.webp`. Both views of a
   garment share one 826 × 900 canvas (same height, centred, one aspect ratio for every piece),
   so swapping views changes the pose, never the size or position. The outputs are committed,
   so the build needs no Python.
2. **Each piece is a catalog product.** `npm run catalog:rail` imports them from
   `backend/scripts/catalog-import/curated/rail.json`. They are SYNTHETIC demo products like the
   Dark Edit (ADR 0013): invented names and copy, synthetic price and stock, and the `EVORA`
   brand. Each product has two gallery photos, front then side. These are 1200 × 1500 studio
   shots rendered by the same script from the same cut-outs. `persistProduct` gained `gallery`
   photos for this, written only together with the main photo
   (`docs/fashion-catalog-setup.md` §15).

   The rail itself stays a static list (`arrivals-data.ts`): look, product slug, name, colour,
   length (a hoodie hangs lower than a tee) and category. Each garment links to
   `/products/<slug>`, where price, sizes and stock come from the server. `tests/rail.test.ts`
   fails if a rail slug or name drifts from what the importer creates. The rail does not call
   `GET /products/arrivals`: that endpoint returns one `CUTOUT` per product, and the rail needs
   two views.
3. **The rail.** A metal rod with wall brackets runs only across the garments, plus an
   overhang wide enough that an end garment pushed aside keeps its hook on the rod. The list is
   centred at its own width and uses the page gutters. It scrolls sideways only when it is
   wider than the screen, and clips its few pixels of vertical overflow (sway, scale) rather
   than show a scrollbar. Slots are 0.42 × the garment height. A garment side-on is about 0.36,
   so each has a gap beside it.
4. **The turn (CSS only, ADR 0010).** Each garment sets `--t` (0 side-on, 1 facing front) and
   swaps two easings. Everything else derives from `--t`:
   - The outgoing photo swings away on the Y axis (side to +58°, front to −58°) and fades,
     starting at once on an accelerating curve.
   - The incoming photo swings in from the other side 170 ms later, on a decelerating curve
     with a slight overshoot.
   - The hanger opens from edge-on to face the front.
   - The garment comes forward slightly and the rest of the rail dims.
   - Neighbours slide aside, and the name, colour and "Shop <category>" link appear under it.

   A transition takes its timing from the state it moves to, so leaving mid-turn reverses
   smoothly from wherever the garment is. The turn takes about 600 ms either way. Slots never
   change width, and only `.arrival-hit` (the garment's outline, narrow side-on and wide facing
   front) takes the pointer, so a turned sleeve never lands on a neighbour.
5. **Input parity and reduced motion.** These follow ADR 0017:
   - Hover turns a garment only where `(hover: hover)`. Keyboard focus also turns it.
   - On a touch screen the first tap turns it and the second follows the link.
   - Under reduced motion every garment hangs facing front at a smaller size, with its name
     showing.
6. **Entrance and off-screen pause (plan.md Phase 5, 2026-11-16).**
   - The first time the rail scrolls into view, the garments slide in along the rod from 60px
     to the right, fading in 0.05s apart (`RevealGroup items="slide"`). GSAP owns only each
     garment's `.arrival-enter` wrapper (a `RevealItem` between the `li` and its link), so the
     sway, push and turn stay CSS. Under reduced motion they fade in place.
   - The sway is an infinite CSS animation. An `IntersectionObserver` sets `is-offscreen` on
     `.arrivals-rail` while it is out of view, and `animation-play-state: paused` holds the
     sway until it returns. `e2e/tests/motion.spec.ts` checks both.
7. **WebGL layer (plan.md Phase 6, 2026-11-17). Shipped: on by default, go decided by the user.**
   - `recent-arrivals/rail-3d/` can lay a React Three Fiber canvas over the list. The canvas
     draws the garments as bent, lit planes, and draws nothing else.
   - The DOM rail above stays the page and the fallback: links, labels, hangers, hit areas,
     state, sway, push and entrance. The canvas reads them each frame and owns no CSS property.
     Once it has drawn, `.arrivals-rail.is-3d` hides the DOM photos.
   - It mounts only when all of these hold:
     - it is not switched off: `NEXT_PUBLIC_RAIL_3D=false` at build time, or `?rail=css` per
       page load (`?rail=3d` forces it on);
     - a fine pointer that can hover;
     - no reduced-motion preference;
     - WebGL2;
     - the rail is within one viewport.
   - Measured, it adds a 245KB gzipped lazy chunk (the budget was 180KB). It holds 60fps and
     leaves interaction latency unchanged. The visual gain over the real side and front photos
     is subtle.
   - I recommended no-go on those numbers; the user chose go (6.4), accepting the 65KB over
     budget. Everyone the gate leaves out (touch, reduced motion, no WebGL2, a lost context,
     `?rail=css`) keeps the CSS rail, so it remains the baseline every change must keep
     working. `e2e/tests/rail-3d.spec.ts` checks the gate.
8. **Proximity sway (plan.md Phase 7.4, 2026-11-17).**
   - With a mouse, a garment the pointer passes beside swings a little wider, as if brushed:
     from ±1deg up to ±2.4deg.
   - `ArrivalsRail` sets each `.arrival`'s `--near` target, from 0 to 1. The value falls off
     over about two slots either side of the pointer. The garment under the pointer stays at
     0, because it is turning to face front.
   - `--near` is a typed `@property`, so its 900ms transition eases the amplitude instead of
     snapping it mid-swing. The `arrival-sway` keyframes read it.
   - Slot centres are measured on entry and on sideways scroll, not every frame.
   - Off for touch, pens and reduced motion. The WebGL layer copies the sway's angle, so it
     follows automatically.

## Consequences
- Adding a piece means:
  1. Add its 2 photos and an entry in the script's `GARMENTS`, then run the script.
  2. Add the product to `rail.json`, then run the importer.
  3. Add an entry to `arrivals-data.ts`.
- The rail draws without the backend, but its links need the imported products. On a database
  without them, a garment opens the product page's not-found state. `fetchArrivals` and the
  arrivals endpoint remain, with no storefront caller.
- The rail's hover label shows the name, colour and a "View details" link, but no price. The
  price is on the product page, from the server.
- The original PNGs (about 9 MB) are still in `public/` and would be served if requested. Only
  the cut-outs (18–75 KB each) are referenced.

## Alternatives
- **Product cards on lit stages.** Built and rejected: it lost the rail, which was the
  section's identity.
- **Store side and front cut-outs in the catalog** (a second `CUTOUT` kind and a migration),
  with the rail reading them from the API. Not needed while the rail is a fixed, curated set.
