/**
 * The storefront's above-the-fold entrance, in CSS (`tw-animate-css`), not an engine: it plays
 * from the first paint without waiting for hydration, so a page's `<h1>` is never held back
 * behind JavaScript (ADR 0010). `fill-mode-both` keeps a delayed piece hidden until its turn.
 * Reduced motion: no animation, everything is simply there.
 *
 * Combine with a direction and a delay, for example
 * `cn(ENTER, 'slide-in-from-bottom-3 delay-300')`. For a heading that rises out of a mask, put
 * `ENTER_MASK` on the heading and `cn(ENTER, 'slide-in-from-bottom-full')` on a block span inside.
 *
 * Ownership: CSS owns `opacity` and `translate`/`transform` on the element carrying `ENTER`
 * for the length of the animation. Do not put a GSAP reveal on the same element.
 */
export const ENTER =
  'animate-in fade-in fill-mode-both duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none';

/** A clip for a masked rise. The padding, cancelled by the margin, keeps descenders whole. */
export const ENTER_MASK = '-mb-[0.12em] overflow-hidden pb-[0.12em]';
