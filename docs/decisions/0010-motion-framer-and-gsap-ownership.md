# ADR 0010 — Motion: Framer Motion and GSAP, with Property Ownership

- **Status:** Accepted
- **Date:** 2026-10-25
- **Scope:** `frontend/src/components/storefront/fashion-hero/*` and any later storefront motion

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

## Revisit when

A second surface needs GSAP sequencing with React state (consider `@gsap/react` then), or
bundle budgets make one engine worth removing.
