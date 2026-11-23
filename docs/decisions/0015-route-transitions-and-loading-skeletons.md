# ADR 0015 — Route Transitions and Loading Skeletons

- **Status:** Accepted
- **Date:** 2026-11-01
- **Related:** [ADR 0007](0007-shared-request-and-ui-primitives.md) (loading states),
  [ADR 0010](0010-motion-framer-and-gsap-ownership.md) (motion ownership)

## Context
Store routes had no `loading.tsx`, so a navigation whose prefetch had not finished showed nothing
until the server answered, and `/account` used a spinner where its layout was known. Route changes
swapped the whole page with no transition. The ask was smooth, optimised page transitions and a
skeleton loader wherever one was missing.

The stack already has what is needed: Next 16.4 with `cacheComponents` and partial prefetching
(each route's static shell is prefetched), and React 19.3, whose `<ViewTransition>` drives the
browser's View Transitions API during navigations with no configuration. The theme switch
already uses `document.startViewTransition` for its circle reveal, animating `root` only.

## Decision
1. **Every store route has a skeleton of its own layout**: `loading.tsx` for shop, collections,
   search, product, cart, account and wishlist, plus a neutral `PageSkeleton` at `(store)/` for any
   future route without one. The in-page Suspense fallbacks use the same components
   (`ProductSkeleton`, `ListingFallback`, `CartSkeleton`, `AccountDetailsSkeleton`,
   `WishlistSkeleton`), and the page frames are shared constants so nothing shifts when content
   arrives. No spinner remains where the final layout is known.
2. **Route enter/exit through `PageTransition`** (`components/layout/page-transition.tsx`): a
   `<ViewTransition>` around each page and each route skeleton, never a layout (layouts persist,
   so they never enter or exit). The old page fades out in 140 ms; the new one fades in and rises
   8 px over 280 ms, starting 60 ms in. A skeleton hands over to its page the same way.
3. **CSS owns the animation** (`globals.css`): opacity and transform only, so it stays on the
   compositor; `::view-transition` lets pointer events through; `prefers-reduced-motion` reduces
   every view transition to an instant swap. Browsers without the API swap pages as before.
4. **No permanent `view-transition-name`**, not even on the header: it would lift the header out
   of the theme switch's `root` circle reveal. Header and footer ride the default root crossfade,
   which shows identical pixels as still.
5. **In-place URL changes do not animate.** A filter, sort, search or results page changes the URL
   and can remount the page segment, which would otherwise fade the whole page. Those navigations
   pass the `IN_PLACE_NAVIGATION` transition type (`<Link transitionTypes>`,
   `router.replace(…, { transitionTypes })`), which `PageTransition` maps to `none`.

## Amendment (2026-11-18, plan.md Phase 9): no catch-all store skeleton
The neutral `PageSkeleton` at `(store)/loading.tsx` (decision 1) is removed. Every store page
sat inside its Suspense boundary, and React sends a large boundary's fallback first and its
content after it. On a direct load every store page therefore painted the generic skeleton
first. On a throttled phone, the home page's real content replaced it about 2.6s in. The footer
jumped off the screen (CLS 0.385, every run) and the hero photo, the LCP element, appeared late.
Without the file, static pages paint their content directly. Measured on the home page: CLS 0.
LCP went from 2.72s to 2.37s (lab mobile, 4× CPU, slow 4G).

Routes whose content needs the server at request time keep their own `loading.tsx`: shop,
collections, search, product, cart, checkout, account, orders and wishlist. Pages without one
(the home page, FAQ, shipping, privacy, terms, forgot and reset password) are static or stream
their own parts behind `<Suspense>`, and their static shell is in the route prefetch.

Consequence: a new store page that reads request-time data must ship its own `loading.tsx`
(or its own `<Suspense>`); there is no generic fallback behind it. The removed file is kept at
`.playwright-mcp/phase9/removed/(store)/loading.tsx` (it was never committed).

## Consequences
- Motion ownership (ADR 0010) gains a third owner: the browser's View Transitions API, driven by
  React, owns route-level enter/exit. Framer Motion and GSAP still own in-page presence and
  choreography; nothing animates the same property twice.
- A new store page must wrap its content in `PageTransition` and ship a `loading.tsx` that does
  too; a new in-page navigation must pass `IN_PLACE_NAVIGATION`.
- Only Chromium and recent Safari/Firefox animate; that is progressive enhancement, not a
  dependency.

## Alternatives
- **Framer Motion `AnimatePresence` around the route** — needs the old route kept mounted, which
  fights the App Router's segment cache and its hidden `<Activity>` copies of previous routes.
- **A `template.tsx` wrapper** — remounts per child segment, so `/products/a` → `/products/b` and
  `/collections/men` → `/collections/women` would not animate.
- **Keying a wrapper in the layout by pathname** — remounts the whole route subtree on every
  navigation and discards the router's preserved state.
