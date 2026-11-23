'use client';

import { useLayoutEffect, useRef } from 'react';

import {
  EASE_OUT,
  gsap,
  MOTION_QUERIES,
  REVEAL,
  useScrollTriggerAutoRefresh,
} from '@/lib/motion/gsap';
import { cn } from '@/lib/utils';

import { Wordmark } from './brand';

/** The wordmark's letters. Letters only: the display face is a demo build (globals.css). */
const LETTERS = Array.from('EVORA');

/**
 * The footer's full-width wordmark, closing the page the way the hero opens it: the first time
 * it scrolls into view, each letter rises out of its own mask, one after another (plan.md
 * Phase 5). Once only; under reduced motion the word fades in place instead.
 *
 * Property ownership (ADR 0010): GSAP owns `transform` (yPercent) on each `[data-char]` and,
 * under reduced motion, `opacity` on the link. Nothing else animates them; the link's focus
 * ring is an outline, not a transform.
 *
 * The letters are `aria-hidden` spans inside the link, whose name stays "EVORA home"
 * (`Wordmark`'s label). The server HTML is the composed word, so without JavaScript nothing is
 * hidden; the starting state is applied in a layout effect, before the first client paint.
 */
export function FooterWordmark({ className }: { className?: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  useScrollTriggerAutoRefresh();

  useLayoutEffect(() => {
    const link = ref.current;
    if (!link) return;
    const chars = link.querySelectorAll('[data-char]');
    const mm = gsap.matchMedia();
    const scrollTrigger = { trigger: link, start: 'top 90%', once: true };

    mm.add(MOTION_QUERIES.motion, () => {
      gsap.from(chars, {
        yPercent: 118,
        duration: REVEAL.lineDuration,
        ease: EASE_OUT,
        stagger: REVEAL.charStagger,
        scrollTrigger,
      });
    });
    mm.add(MOTION_QUERIES.reduced, () => {
      gsap.from(link, {
        opacity: 0,
        duration: REVEAL.fadeDuration,
        ease: 'none',
        scrollTrigger,
      });
    });

    return () => mm.revert();
  }, []);

  return (
    <Wordmark ref={ref} className={cn(className)}>
      {LETTERS.map((letter, index) => (
        // Each letter rises through its own mask. The padding (cancelled by the negative
        // margin) keeps the mask clear of the glyph, so nothing is clipped at rest and the
        // word's width and line box do not change.
        <span
          key={index}
          aria-hidden="true"
          className="-mx-[0.08em] -my-[0.14em] inline-block overflow-clip px-[0.08em] py-[0.14em]"
        >
          <span data-char="" className="inline-block">
            {letter}
          </span>
        </span>
      ))}
    </Wordmark>
  );
}
