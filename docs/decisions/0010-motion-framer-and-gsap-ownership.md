# ADR 0010 — Motion: Framer Motion and GSAP, with Property Ownership

- **Status:** Accepted
- **Date:** 2026-10-25
- **Scope:** `frontend/src/components/storefront/fashion-hero/*` and any later storefront motion

## Current owners (checked against the code 2026-11-18, plan.md 10.3)

The Decision below is the original record, and the amendments after Consequences change parts of
it (Framer Motion no longer owns the indicators or press feedback, for example). This is where
they leave each engine today:

| Owner | What it animates |
|---|---|
| Framer Motion | The hero's slide presence (`AnimatePresence` with `usePresence`) and each slide root's fade; the autoplay clock and the `HeroProgress` hairline's `scaleX`; the slide counter's roll; the auth page. Only `/` and `/auth` include it in their own JavaScript. |
| GSAP and ScrollTrigger | The hero's choreography (`hero-motion.ts`) and its pointer-parallax variables; `RevealGroup`, `ScrollParallax`, `ScrollAway`, `BatchReveal` / `ClipReveal` and the footer wordmark. GSAP's ticker also drives Lenis. |
| CSS | Press feedback, the hero indicators, the header badge pop, card hover zoom, the menu's enter and exit, the header hiding on scroll, the theme icon's spin, all of the Recent Arrivals rail's motion (ADR 0027), and the inner pages' above-the-fold entrances (`lib/motion/enter.ts`: `PageHeader`, the collection banner, the product page, bag lines, the mobile filter panel, the 404). |
| The browser's View Transitions | Route enter and exit (ADR 0015) and the theme switch's circle reveal. |
| three.js / React Three Fiber | The rail's optional WebGL layer (ADR 0027 §7). |

## Context

Both `framer-motion` and `gsap` were already dependencies; only Framer Motion was in use (the
auth page). The home-page campaign hero needs both kinds of motion: React-driven presence
(two slides on screen at once during a change, controls that react to state) and a
choreographed, staggered sequence across many layers of one slide. Two engines writing the
same CSS `transform` on the same element is the classic failure: each overwrites the
other's matrix every frame and the element jitters or snaps.

## Decision

Use both, with one owner per animated property per element, written down beside the code.

- **Framer Motion** owns React lifecycle and UI state: `AnimatePresence` (the outgoing slide
  stays mounted until `usePresence`'s `safeToRemove` is called), the slide root's fade-in,
  the autoplay clock (a motion value animated from 0 to 1; the same value fills the active
  indicator, so the bar and the timer cannot disagree), indicator widths and press feedback.
  Components sit under `MotionConfig reducedMotion="user"`.
- **GSAP** owns choreography inside a slide (`hero-motion.ts`): masked letter reveals, the
  model's entrance and exit, copy and CTA staggers, the idle drift, and the pointer parallax.
  All of a slide's tweens live in one `gsap.context`, reverted on unmount, so interrupted
  sequences and React Strict Mode's double effects leave nothing behind. `@gsap/react` is not
  added: `useLayoutEffect` plus `gsap.context` is what `useGSAP` wraps.
- **CSS** owns layout and depth: positioning wrappers use the `translate` property, and
  parallax wrappers read `--hero-px`/`--hero-py` (eased by GSAP on the section) into
  `translate`. `translate` composes with `transform` instead of replacing it.
- An element that needs two kinds of movement gets a wrapper per kind (for example, the model
  has position → depth → entrance/exit → idle drift → image).

## Consequences

- The ownership table at the top of `hero-motion.ts` is the contract; a new animated layer
  is added there first.
- Reduced motion is honoured in both engines: Framer through `MotionConfig`, GSAP through an
  opacity-only branch, with no drift and no parallax.
- Two animation libraries ship to the storefront. That cost was already paid (both were
  installed); new motion should still default to CSS transitions and reach for an engine only
  for sequencing or presence.

- Scroll-driven motion below the hero is GSAP ScrollTrigger (amended 2026-11-02):
  `components/storefront/reveal.tsx` (`RevealGroup` plays one timeline per section on first
  scroll into view across `RevealItem`/`RevealLine`/`RevealRule`, found by `data-reveal`) and
  `components/storefront/scroll-motion.tsx` (`ScrollParallax`, `ScrollAway` for the hero's
  scroll-out, `BatchReveal` for product grids, row by row). Each file's ownership table is the
  contract. ScrollTrigger is registered once in `lib/motion/gsap.ts`, which also re-measures
  triggers when the page height changes. Lenis is driven by GSAP's ticker (`autoRaf: false`)
  and feeds ScrollTrigger on every scroll, so scrubbed motion and smooth scroll share a frame.
  Framer Motion keeps the hero's presence, autoplay and controls, and the auth page.
- An above-the-fold listing banner animates with CSS (`tw-animate-css`), not an engine, so the
  page's `<h1>` never waits on hydration.
- Route-level enter/exit has its own owner: React `<ViewTransition>` and the browser's View
  Transitions API, through `PageTransition` ([ADR 0015](0015-route-transitions-and-loading-skeletons.md)).
- Shared entrance timing (amended 2026-11-16): `REVEAL` in `lib/motion/gsap.ts` holds the
  durations, stagger and travel that `RevealGroup` and `BatchReveal` use, so sections cannot
  drift apart.
  - Items travel 24px over 0.8s, masked lines rise over 0.9s, and rules draw over 0.8s. These
    were 32–36px over 1.1–1.2s, which made a fast scroll wait on copy.
  - Under reduced motion, items fade over 0.4s.
  - Change the timing there, not in a component.
- Hero entrance waits for the model (amended 2026-11-16, plan.md Phase 3).
  - `[data-hero=figure]` is the model's only visibility owner (GSAP). The `<img>` inside used
    to fade itself in from React state set in `onLoad`. That was a second, unsynchronised
    owner: under a cold cache or a busy main thread, the GSAP walk-in played on a transparent
    image and the model popped in about 1s later, leaving frames with only the contact
    shadow.
  - `enter()` now builds the slide's timeline paused, with the starting state rendered before
    paint. The slide then waits for the image to load and `decode()`, for at most 600ms, and
    calls `play()`.
  - The model has its own tween, outside the timeline. If the image is late, the word and copy
    play without it and `revealFigure()` walks the model in when it arrives. A failed image
    keeps the figure, and its shadow, hidden.
  - `e2e/tests/hero.spec.ts` guards this: no frame shows the figure without a loaded image,
    and the model is opaque within 1.5s of "Next".
- One entrance per section (amended 2026-11-16, plan.md Phase 5).
  - `RevealGroup` takes `items`: `rise` (the default fade-up), `slide` (along the row, `x`),
    `fade` (in place) or `false` (items do not move; only masked lines and rules play).
    The service strip and the FAQ use `false`; the reviews use `fade`.
  - `BatchReveal effect="clip"`: each row's photos wipe up into their frames. GSAP owns
    `clip-path` on the `ClipReveal` layer inside each card's image box and clears it when the
    wipe lands, while the card (`li`) fades in. The Dark Edit uses it. The card's hover zoom
    stays CSS on the image inside the layer, so no property has two owners.
  - The footer wordmark's letters rise out of their masks once (`FooterWordmark`, GSAP
    `yPercent` on each letter), echoing the hero word.
  - The new timings live in `REVEAL` (`slideX`, `slideStagger`, `clipDuration`,
    `captionDuration`, `charStagger`). Under reduced motion every one of them is a plain fade.
  - The Recent Arrivals rail's garments slide in along the rod (`items="slide"` on a
    `.arrival-enter` wrapper; ADR 0027 §6).
  - Loops pause off screen: the hero's idle drift (`setOnScreen` in `hero-motion.ts`, from an
    `IntersectionObserver` on the slide) and the autoplay clock (an observer on the hero) both
    hold while the hero is out of view and resume where they stopped. The rail's CSS sway
    pauses the same way (`is-offscreen` on `.arrivals-rail`).
  - Not adopted: a scroll-scrubbed campaign headline (plan.md 5.6). It would break the rule
    that entrances run once and text never scrubs.
- The Recent Arrivals rail's motion is CSS only. Its rules and ownership are recorded in
  [ADR 0027](0027-recent-arrivals-turntable.md).
- Micro-interactions move to CSS (amended 2026-11-17, plan.md Phase 7). This supersedes the
  Decision's "indicator widths and press feedback" for Framer Motion.
  - Press feedback is one unlayered `.press` rule in `globals.css`. It owns `scale` (a 3%
    dip, 100ms down and 160ms back) and the element's whole `transition` list, so it beats any
    Tailwind `transition-*` utility on the same element. It is used on the hero CTAs and
    controls, the campaign CTA and the newsletter submit. The hero controls dip to 0.92 through
    `--press-scale`. Reduced motion: no dip.
  - The hero indicators no longer change width. Animating a layout property nudged their
    neighbours, a CLS of about 0.00004 per change. They are fixed 24px segments, and CSS owns
    their colour and a `scale-y` thickening. The autoplay timer moved to `HeroProgress`, a 1px
    hairline along the hero's foot. Framer Motion still owns its `scaleX`, from the same clock
    value.
  - The header's count badge pops once (`.badge-pop`, CSS `scale` keyframes, 250ms) when a
    known count changes. Reduced motion: none.
  - The product card's hover zoom runs over 900ms instead of 1400ms.
  - The rail's proximity sway is CSS (a typed `--near` per garment, eased by a transition;
    ADR 0027).
- The header hides on scroll past the home hero (amended 2026-11-17, plan.md 2.6). CSS owns
  the header's `translate` (`data-hidden` → `-translate-y-full`, 300ms `--ease-out`).
  `useHeaderAutohide` only decides when, from Lenis' scroll callback; it never animates.
  Reduced motion: it never hides.
- The rail's edge fades below `lg` are a CSS scroll-driven animation (amended 2026-11-17,
  plan.md 8.2). It owns two typed lengths, `--fade-start` and `--fade-end`, on
  `.arrivals-rail`, driven by the rail's own sideways scroll (`animation-timeline:
  scroll(self inline)`). Nothing else animates the rail element itself.
- The theme control's sun/moon spin moved from Framer Motion to CSS (amended 2026-11-18,
  plan.md 9.5). The control is in every page's header, and it was the only reason
  framer-motion was in every route's JavaScript; it now loads with the home hero and `/auth`
  only. Both icons are always rendered in one grid cell; `.theme-icon` keyframes own their
  `opacity`, `rotate` and `scale`. The animation name follows the theme class on `<html>`,
  and its duration is 0 except while `data-theme-transition` is set (the view-transition
  reveal), so first paint, reduced motion and browsers without view transitions show the end
  state at once. Keyframes rather than transitions, because next-themes switches transitions
  off while it swaps the class.
- Inner pages (amended 2026-11-22, `pages-plan.md`).
  - One shared above-the-fold entrance in CSS, `ENTER` / `ENTER_MASK` in `lib/motion/enter.ts`
    (`tw-animate-css`, 1s on `--ease-out`, `motion-reduce:animate-none`). CSS owns `opacity` and
    the transform of each element carrying it for the length of the animation; no GSAP reveal
    sits on the same element. The collection banner now imports it instead of its own copy.
  - `PageHeader` (`components/layout/page-header.tsx`) opens the bag, checkout, order, wishlist,
    account, search and help pages: the eyebrow fades up, the title rises out of its mask, then
    the copy. The `<h1>` is in the server HTML and never waits on hydration.
  - Product page: the gallery settles from 98% as it fades in, the name rises from its mask, and
    the purchase panel and service row follow (CSS). The detail photo drifts with
    `ScrollParallax`, which gained `decorative={false}` so a described photo stays visible to
    assistive technology. Related products use the `inline` `SectionHeading` in a `RevealGroup`
    and `BatchReveal effect="clip"`, the Dark Edit's entrance.
  - Wishlist grid: `BatchReveal` (`rise`), as on `/shop`. Bag lines: a CSS rise, 60ms apart,
    on first load only (keyed rows are not remounted by a re-read).
  - Help pages: the body fades in once after the header; the FAQ page dropped its per-question
    `RevealGroup` so the answers do not wait on a second entrance.
  - Exits for removed bag lines and wishlist cards: `useListPresence`
    (`lib/motion/list-presence.ts`). React Query replaces the data in place, so a removed item
    would unmount at once; the hook keeps it rendered (inert, `aria-hidden`) while it animates
    out, then moves the remaining items from their old positions to their new ones (FLIP).
    React's `<ViewTransition>` was not used because it only animates updates inside a
    transition, and React Query's store updates are synchronous.
    - The Web Animations API owns, on a wrapper inside each `li`: `height` and `opacity` while
      a bag line folds away (280ms, accelerating), `opacity` and `transform` while a wishlist
      card fades (scale 0.96), and `transform` while a remaining item moves (450ms,
      `--ease-out`). The `li` keeps its own entrance owner (CSS in the bag, GSAP `BatchReveal`
      in the wishlist).
    - Focus held inside a leaving item moves to the next item (the previous one if it was
      last). The bag's remove button stays focusable while its request is pending
      (`aria-disabled`), so there is still focus to hand on.
    - Reduced motion: no exit and no move; the item goes at once.
    - Removing the last item shows the empty state, which fades in (CSS) rather than waiting
      on the exit.

## Revisit when

A second surface needs GSAP sequencing with React state (consider `@gsap/react` then), or
bundle budgets make one engine worth removing.
