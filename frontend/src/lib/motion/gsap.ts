'use client';

import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useLayoutEffect } from 'react';

/**
 * The one place GSAP's ScrollTrigger is registered, and the shared settings every
 * scroll-driven storefront animation uses (ADR 0010). Import `gsap` and `ScrollTrigger` from
 * here, not from the packages, so the plugin is always registered first.
 */
gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

/** `gsap.matchMedia` conditions. Every scroll animation has a reduced-motion branch. */
export const MOTION_QUERIES = {
  motion: '(prefers-reduced-motion: no-preference)',
  reduced: '(prefers-reduced-motion: reduce)',
} as const;

/** The theme's `--ease-out` in GSAP terms: a long, decelerating settle. */
export const EASE_OUT = 'expo.out';

/** Where a section's entrance starts: its top a little above the bottom of the screen. */
export const REVEAL_START = 'top 85%';

/**
 * Timing for the storefront's scroll entrances (`RevealGroup`, `BatchReveal`), in seconds and
 * px. One set, so every section settles at the same pace. Editorial, not instant, but short
 * enough that a reader scrolling at speed never waits on copy (ADR 0010): items
 * travel 24px over 0.8s, masked lines rise over 0.9s. Under reduced motion, items fade in place
 * over `fadeDuration`.
 */
export const REVEAL = {
  y: 24,
  duration: 0.8,
  stagger: 0.07,
  lineDuration: 0.9,
  lineStagger: 0.07,
  ruleDuration: 0.8,
  fadeDuration: 0.4,
  fadeStagger: 0.05,
  /** `items="slide"`: pieces arrive along their row, from the reading direction's end. */
  slideX: 60,
  slideStagger: 0.05,
  /** `BatchReveal effect="clip"`: a photo wipes up into its frame while its caption fades. */
  clipDuration: 0.9,
  captionDuration: 0.5,
  /** Masked letters of a wordmark (the footer's), rising one after another. */
  charStagger: 0.05,
} as const;

let refreshUsers = 0;
let refreshObserver: ResizeObserver | null = null;
let refreshFrame = 0;

/**
 * ScrollTrigger measures start and end positions when a trigger is created, and again only on
 * window resize and load. Content above a trigger that settles later (a client-fetched grid,
 * a late font, an accordion) would leave those positions stale, and a reveal would wait for a
 * point the visitor has already scrolled past. One observer on `<body>` re-measures whenever
 * the page's height changes, for as long as any component using this hook is mounted.
 */
export function useScrollTriggerAutoRefresh() {
  useLayoutEffect(() => {
    refreshUsers += 1;
    if (!refreshObserver) {
      let lastHeight = document.body.scrollHeight;
      refreshObserver = new ResizeObserver(() => {
        const height = document.body.scrollHeight;
        if (height === lastHeight) return;
        lastHeight = height;
        cancelAnimationFrame(refreshFrame);
        refreshFrame = requestAnimationFrame(() => {
          ScrollTrigger.refresh();
        });
      });
      refreshObserver.observe(document.body);
    }
    return () => {
      refreshUsers -= 1;
      if (refreshUsers === 0) {
        refreshObserver?.disconnect();
        refreshObserver = null;
        cancelAnimationFrame(refreshFrame);
      }
    };
  }, []);
}
