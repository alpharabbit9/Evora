'use client';

import { useLayoutEffect, useRef } from 'react';

import {
  EASE_OUT,
  gsap,
  MOTION_QUERIES,
  REVEAL,
  REVEAL_START,
  ScrollTrigger,
  useScrollTriggerAutoRefresh,
} from '@/lib/motion/gsap';
import { cn } from '@/lib/utils';

/**
 * GSAP ScrollTrigger primitives for storefront sections (ADR 0010).
 *
 * Property ownership (nothing else may animate these on the same element):
 *
 * | Element                      | Owner | Properties                                    |
 * |------------------------------|-------|-----------------------------------------------|
 * | `ScrollParallax` wrapper     | GSAP  | yPercent, scale (scrubbed to scroll)          |
 * | `ScrollAway` inner wrapper   | GSAP  | yPercent (scrubbed as the section leaves)     |
 * | each child of `BatchReveal`  | GSAP  | opacity, y (staggered once, as rows enter);   |
 * |                              |       | opacity only with `effect="clip"`             |
 * | `ClipReveal` inside a child  | GSAP  | clip-path (`effect="clip"` only, then cleared)|
 *
 * Hover movement belongs on elements inside these, never on them. All use `gsap.matchMedia`,
 * which reverts every tween and trigger it created on unmount and when the motion preference
 * changes: nothing scrubs under reduced motion, and the reveal drops its travel for a fade.
 */

/**
 * Moves its content slightly slower than the page while the section crosses the viewport,
 * optionally settling from a small zoom as it does. The wrapper overhangs its (clipping)
 * parent by 8% above and below, so the travel never uncovers an edge; it is absolutely
 * positioned and stretches to the parent's box.
 */
export function ScrollParallax({
  className,
  children,
  travel = 6,
  zoom = 0,
  decorative = true,
}: {
  className?: string;
  children: React.ReactNode;
  /**
   * Hides the content from assistive technology, for backdrops. Pass `false` when the content
   * is a described image the page relies on (the product page's detail photo).
   */
  decorative?: boolean;
  /** Total movement each way, in percent of the wrapper's height. Keep under the overhang. */
  travel?: number;
  /** Extra scale at the start, settling to 1 as the section reaches the middle of the screen. */
  zoom?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollTriggerAutoRefresh();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const trigger = el.parentElement ?? el;
    const mm = gsap.matchMedia();
    mm.add(MOTION_QUERIES.motion, () => {
      gsap.fromTo(
        el,
        { yPercent: -travel },
        {
          yPercent: travel,
          ease: 'none',
          // A short catch-up instead of a rigid lock, so wheel steps read as one glide.
          scrollTrigger: { trigger, start: 'top bottom', end: 'bottom top', scrub: 0.6 },
        },
      );
      if (zoom > 0) {
        gsap.fromTo(
          el,
          { scale: 1 + zoom },
          {
            scale: 1,
            ease: 'none',
            scrollTrigger: { trigger, start: 'top bottom', end: 'center center', scrub: 0.6 },
          },
        );
      }
    });
    return () => mm.revert();
  }, [travel, zoom]);

  return (
    <div
      ref={ref}
      aria-hidden={decorative ? true : undefined}
      className={cn('absolute inset-x-0 -inset-y-[8%]', className)}
    >
      {children}
    </div>
  );
}

/**
 * For a full-bleed opener at the top of a page: as it scrolls away, its content drifts down
 * at a fraction of the scroll speed inside a clip, so the next section slides up over it
 * instead of pushing it off as one flat slab. Purely positional; the content keeps its own
 * motion (the hero's GSAP layers sit on elements inside this wrapper).
 */
export function ScrollAway({
  className,
  children,
  travel = 18,
}: {
  className?: string;
  children: React.ReactNode;
  /** Downward drift by the time the section has fully left, in percent of its height. */
  travel?: number;
}) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useScrollTriggerAutoRefresh();

  useLayoutEffect(() => {
    const trigger = outer.current;
    const el = inner.current;
    if (!trigger || !el) return;
    const mm = gsap.matchMedia();
    mm.add(MOTION_QUERIES.motion, () => {
      gsap.to(el, {
        yPercent: travel,
        ease: 'none',
        scrollTrigger: { trigger, start: 'top top', end: 'bottom top', scrub: true },
      });
    });
    return () => mm.revert();
  }, [travel]);

  return (
    <div ref={outer} className={cn('overflow-clip', className)}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

/**
 * Staggers its children in as they scroll into view, a batch at a time: everything that
 * enters together (one row of a grid, or the whole first screen) rises in reading order, so a
 * long grid never animates rows that are still off screen.
 *
 * Opacity only, never `visibility`: a hidden link would drop out of the tab order, and
 * tabbing to a card that has not revealed yet should scroll it in (and reveal it), not skip it.
 *
 * `effect="clip"` swaps the rise for an image reveal, still one row at a time: each child's
 * `ClipReveal` layer wipes up from its foot over `REVEAL.clipDuration` while the rest of the
 * child (frame and caption) fades in over the shorter `REVEAL.captionDuration`, with no travel.
 * Under reduced motion both effects are the same plain fade.
 */
export function BatchReveal({
  as: Tag = 'div',
  className,
  children,
  effect = 'rise',
}: {
  as?: 'div' | 'ul';
  className?: string;
  children: React.ReactNode;
  effect?: 'rise' | 'clip';
}) {
  const ref = useRef<HTMLDivElement & HTMLUListElement>(null);
  useScrollTriggerAutoRefresh();

  // Layout effect: the hidden starting state is applied before the first paint, so the grid
  // never flashes fully composed and then blinks out.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const items = Array.from(el.children);
    const mm = gsap.matchMedia();

    const reveal = (from: gsap.TweenVars, to: gsap.TweenVars) => {
      gsap.set(items, from);
      ScrollTrigger.batch(items, {
        start: REVEAL_START,
        once: true,
        onEnter: (batch) => gsap.to(batch, { ...to, overwrite: true }),
      });
    };

    mm.add(MOTION_QUERIES.motion, () => {
      if (effect === 'clip') {
        const clipOf = (item: Element) => item.querySelector('[data-reveal="clip"]');
        const clips = items.map(clipOf).filter((clip) => clip !== null);
        gsap.set(items, { opacity: 0 });
        gsap.set(clips, { clipPath: 'inset(100% 0% 0% 0%)' });
        ScrollTrigger.batch(items, {
          start: REVEAL_START,
          once: true,
          onEnter: (batch) => {
            gsap.to(batch, {
              opacity: 1,
              duration: REVEAL.captionDuration,
              ease: 'power1.out',
              stagger: REVEAL.stagger,
              overwrite: true,
            });
            const batchClips = batch.map(clipOf).filter((clip) => clip !== null);
            if (batchClips.length === 0) return;
            gsap.to(batchClips, {
              clipPath: 'inset(0% 0% 0% 0%)',
              duration: REVEAL.clipDuration,
              ease: EASE_OUT,
              stagger: REVEAL.stagger,
              overwrite: true,
              clearProps: 'clipPath',
            });
          },
        });
        return;
      }
      reveal(
        { opacity: 0, y: REVEAL.y },
        {
          opacity: 1,
          y: 0,
          duration: REVEAL.duration,
          ease: EASE_OUT,
          stagger: REVEAL.stagger,
        },
      );
    });
    mm.add(MOTION_QUERIES.reduced, () => {
      reveal({ opacity: 0 }, { opacity: 1, duration: REVEAL.fadeDuration, ease: 'none' });
    });

    return () => mm.revert();
  }, [effect]);

  return (
    <Tag ref={ref} className={className}>
      {children}
    </Tag>
  );
}
