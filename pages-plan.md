# EVORA Inner Pages — Motion & UI Audit and Plan

> Companion to `plan.md` (homepage). Audit date: 2026-11-22, `next dev`, headless Chromium,
> 1440 and 390 wide, light theme, signed out and signed in (a local test customer).
> Evidence: `.playwright-mcp/pages-audit/`.
> Rules carried over from `plan.md` §G: one owner per animated property (ADR 0010), reduced-motion
> branch for every animation, no new dependencies, no placeholder presented as final, CSS first for
> above-the-fold entrances (the `<h1>` never waits on hydration).

## 1. What the homepage established (reuse, don't reinvent)

| Need | Existing primitive |
|---|---|
| Above-the-fold entrance | CSS `tw-animate-css` (`animate-in fade-in slide-in-from-bottom-*`, `fill-mode-both`), as in `CollectionBanner` |
| Masked headline rise | `slide-in-from-bottom-full` inside an `overflow-hidden` clip (`CollectionBanner`), or `RevealLine` in a `RevealGroup` |
| Below-the-fold entrance | `RevealGroup` / `RevealItem` / `RevealLine` / `RevealRule` (GSAP, once) |
| Product grids | `BatchReveal` (`rise`, or `clip` with `ClipReveal` in the card) |
| Section openers | `SectionHeading` (`editorial`, `inline`, `index`) |
| Photo depth | `ScrollParallax` (GSAP scrub, off under reduced motion) |
| Route change | `PageTransition` (View Transitions) |

## 2. Audit findings

| # | Page | Finding | Evidence |
|---|---|---|---|
| F1 | Bag, wishlist, checkout, order | Page openers are a bare Playfair `<h1>`; listing and help pages use eyebrow + title. Four ways of opening a page across the store, and none of the inner pages has an entrance: content just appears. | `1440-cart*.jpg`, `1440-wishlist.jpg`, `1440-checkout.jpg` |
| F2 | Account | The odd one out: a 20px sans `Your account`, a centred 672px column that lines up with nothing else, and plain sans section titles. Reads as an unstyled admin form inside an editorial store. | `1440-account.jpg` |
| F3 | Help & legal (`/faq`, `/shipping`, `/privacy`, `/terms`) | Text sits in a 68ch column on the left; at 1440 the right half of the page is empty. Multi-section pages have no way to jump between sections. | `1440-faq.jpg`, `1440-shipping.jpg` |
| F4 | Product page | No entrance at all, while the listing that links to it animates. "You may also like" uses its own ad-hoc opener and a static grid instead of the store's `inline` heading and the Dark Edit's clip reveal. The detail photo is static. | `1440-products_*.jpg` |
| F5 | Wishlist | Static grid: the same cards animate in on `/shop` but not here. | `1440-wishlist.jpg` |
| F6 | Bag | Lines appear all at once when the bag loads. | `1440-cart.jpg` |
| F7 | Search / listings | The search header (`CatalogHeader`) has no entrance, unlike the collection banner. Mobile "Filters" panel snaps open with no transition. | `1440-search_q_jacket.jpg`, `390-shop.jpg` |
| F8 | 404 | Correct but inert: no entrance and a single exit ("Back to home"). A lost visitor gets no path into the catalog. | `1440-does_not_exist.jpg` |

Checked and **not** a bug:
- The footer wordmark looked missing in some full-page captures. Real wheel scrolling plays it every
  time; the captures used scripted `scrollTo` jumps that Lenis smooths over.
- The PDP's three-icon service row includes "Easy Returns". It is already gated by
  `visiblePolicyContent` (ADR 0026), so a production build drops it.
- `/auth` already has a Framer Motion entrance and a strong composition; left as is.

## 3. Plan (smallest safe set, in order)

### P1. One page opener: `PageHeader` (fixes F1, F2, F3, F7)
- New `components/layout/page-header.tsx` (Server Component): ruled eyebrow, Playfair `<h1>` rising
  out of a mask, optional description and children (search box, notices).
- Entrance is CSS (`tw-animate-css`), the same timing as `CollectionBanner`: eyebrow fades up at
  100ms, the title rises from its mask at 150ms, the description at 300ms. `motion-reduce:animate-none`.
  The `<h1>` is in the server HTML at full opacity without JavaScript, and never waits on hydration.
- The shared `ENTER` classes move to `lib/motion/enter.ts` so the banner and the header cannot drift.
- Used by: bag, wishlist, checkout, order, account, help pages (`InfoPage`), search (`CatalogHeader`),
  with eyebrows `Bag`, `Saved`, `Checkout`, `Order`, `Account`, and the existing ones.
- Skeletons gain the eyebrow row so the heading does not jump when the page streams in.

### P2. Account page in the store's language (fixes F2)
- Container and gutters of every other page; from `lg`, a sticky "On this page" index (Profile,
  Addresses, Password, Devices, Orders) beside a reading-width column of sections.
- Section titles in Playfair (`AccountSection`, `OrderHistory`), sections `scroll-mt` under the header.
- No behaviour change: same forms, same buttons, same order history.

### P3. Help pages use their width (fixes F3)
- `InfoPage` takes an optional `contents` list; from `lg` it renders as a sticky index in the right
  column (`/shipping`, `/privacy`, `/terms`). `/faq` gets a short "Still need help?" aside pointing to
  the shipping page and the shop.

### P4. Product page (fixes F4)
- Above the fold, CSS entrance: the gallery fades and settles from a 1.03 scale; the info column's
  blocks rise in sequence (title, purchase, service row).
- Detail photo drifts against the scroll (`ScrollParallax`, as the collection banner does).
- Related products: `SectionHeading variant="inline"` inside a `RevealGroup`, cards in
  `BatchReveal effect="clip"` (the Dark Edit's entrance).

### P5. Wishlist and bag (fixes F5, F6)
- Wishlist grid in `BatchReveal` (`rise`), as on `/shop`.
- Bag lines rise in once, 60ms apart, with CSS when the bag first loads (not on every refetch).

### P6. Listings (fixes F7)
- Mobile filter panel fades and drops 8px in when opened (CSS, `lg` and up untouched).

### P7. 404 (fixes F8)
- Headline rises out of its mask (CSS); the copy and links follow.
- Links into the store: Shop all, Men, Women, New arrivals, plus Back to home.

### P8. Exit animations (follow-up, done)
- `useListPresence` (`lib/motion/list-presence.ts`): a removed bag line folds away; a removed
  wishlist card fades and the cards after it glide into the gap. The leaving item is inert, focus
  moves to the next item, and reduced motion removes it at once. The empty state fades in when the
  last item goes. React `<ViewTransition>` could not be used: it only animates transition
  updates, and React Query's updates are synchronous.

### Not in scope (recorded, not done)
- Product-image fade-in on lazy load (would add a second opacity owner next to `BatchReveal`).
- Admin dashboard (a tool, not a storefront page).

## 4. Verification
- `npm run lint`, `npm run typecheck`, `npm run build` in `frontend/`.
- Playwright screenshots at 1440 and 390, light and dark, and reduced motion, for every changed page.
- Keyboard: account index links move focus to their sections; 404 links are reachable.
- ADR 0010 amended with the new owners (CSS page header entrance, PDP entrance, related products).
