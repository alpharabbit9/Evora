'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Exit animations for a list whose data is replaced in place (a React Query cache update), so
 * an item that leaves the data would otherwise unmount at once (pages-plan.md, "exit
 * animations"). Each item the data drops stays rendered where it was, marked `leaving`: inert
 * and hidden from assistive technology, so it can no longer be used or announced, while it
 * animates out. When it is gone, the items that remain glide from where they were to where
 * they now sit (FLIP), instead of jumping into the gap.
 *
 * Why not React's `<ViewTransition>`: it only animates updates made inside a transition, and
 * React Query's store updates are always synchronous.
 *
 * Ownership (ADR 0010): the Web Animations API owns, on each item's bound element (`bind`),
 * `height` and `opacity` while it collapses (`exit="collapse"`), `opacity` and `transform`
 * while it fades (`exit="fade"`), and `transform` while a remaining item moves. Bind it to a
 * wrapper of its own, inside any element another engine animates (a `BatchReveal` item, a CSS
 * entrance), never to that element.
 *
 * Reduced motion: no exit and no move; a removed item goes at once, as before.
 *
 * Focus: if the leaving item holds focus (its remove button), focus moves to the next item,
 * or the previous one when it was last, so the keyboard user is not dropped to the page top.
 */

export type ListExit = 'collapse' | 'fade';

export type PresenceEntry<T> = { key: string; item: T; leaving: boolean };

/** Exits take the store's quick UI timing and accelerate away (plan.md §D: power2.in). */
const EXIT_MS = 280;
const EXIT_EASE = 'cubic-bezier(0.55, 0, 1, 0.45)';
/** Remaining items settle on the theme's `--ease-out`. */
const MOVE_MS = 450;
const MOVE_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** The first thing in an item a keyboard user can reach (not a `tabindex="-1"` image link). */
const FOCUSABLE =
  'a[href]:not([tabindex="-1"]), button:not([disabled]), input:not([disabled]), [tabindex="0"]';

/**
 * The new items in order, with every item that has just left (or is still leaving) kept just
 * after the item that preceded it before, so it fades where the visitor saw it.
 */
function merge<T>(
  previous: readonly PresenceEntry<T>[],
  items: readonly T[],
  getKey: (item: T) => string,
): PresenceEntry<T>[] {
  const next: PresenceEntry<T>[] = items.map((item) => ({
    key: getKey(item),
    item,
    leaving: false,
  }));
  const present = new Set(next.map((entry) => entry.key));
  let anchor = -1;
  for (const entry of previous) {
    if (present.has(entry.key)) {
      anchor = next.findIndex((candidate) => candidate.key === entry.key);
      continue;
    }
    anchor += 1;
    next.splice(anchor, 0, { ...entry, leaving: true });
  }
  return next;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function useListPresence<T>(
  items: readonly T[],
  getKey: (item: T) => string,
  { exit = 'fade' }: { exit?: ListExit } = {},
) {
  const [state, setState] = useState(() => ({ items, entries: merge([], items, getKey) }));
  let entries = state.entries;
  if (state.items !== items) {
    // Derived from the new data during render (React's "storing information from previous
    // renders" pattern), so a leaving item never disappears for even one frame.
    entries = merge(state.entries, items, getKey);
    setState({ items, entries });
  }

  const elements = useRef(new Map<string, HTMLElement>());
  /** Where every other item was just before a leaving one was taken out, for the FLIP. */
  const before = useRef<Map<string, DOMRect> | null>(null);
  const exiting = useRef(new Set<string>());

  const finish = useCallback((key: string) => {
    const rects = new Map<string, DOMRect>();
    for (const [other, element] of elements.current) {
      if (other !== key) rects.set(other, element.getBoundingClientRect());
    }
    before.current = rects;
    exiting.current.delete(key);
    setState((current) => ({
      ...current,
      entries: current.entries.filter((entry) => !(entry.key === key && entry.leaving)),
    }));
  }, []);

  useLayoutEffect(() => {
    const reduced = prefersReducedMotion();

    // Move: every remaining item starts where it was and settles where it now is.
    const rects = before.current;
    before.current = null;
    if (rects && !reduced) {
      for (const [key, rect] of rects) {
        const element = elements.current.get(key);
        if (!element) continue;
        const now = element.getBoundingClientRect();
        const dx = rect.left - now.left;
        const dy = rect.top - now.top;
        // A collapsed item leaves only its border behind; a shift that small is not a move.
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
        element.animate(
          [{ transform: `translate(${String(dx)}px, ${String(dy)}px)` }, { transform: 'none' }],
          { duration: MOVE_MS, easing: MOVE_EASE },
        );
      }
    }

    // Exit: start each newly leaving item's animation once.
    entries.forEach((entry, index) => {
      if (!entry.leaving || exiting.current.has(entry.key)) return;
      exiting.current.add(entry.key);
      const element = elements.current.get(entry.key);
      if (!element || reduced) {
        finish(entry.key);
        return;
      }

      if (element.contains(document.activeElement)) {
        const remaining = (from: number, step: number) => {
          for (let at = from; at >= 0 && at < entries.length; at += step) {
            const candidate = entries[at];
            if (candidate && !candidate.leaving) return elements.current.get(candidate.key);
          }
          return undefined;
        };
        const target = remaining(index + 1, 1) ?? remaining(index - 1, -1);
        target?.querySelector<HTMLElement>(FOCUSABLE)?.focus({ preventScroll: true });
      }

      const keyframes: Keyframe[] =
        exit === 'collapse'
          ? [
              { height: `${String(element.offsetHeight)}px`, opacity: 1, overflow: 'hidden' },
              { height: '0px', opacity: 0, overflow: 'hidden' },
            ]
          : [
              { opacity: 1, transform: 'scale(1)' },
              { opacity: 0, transform: 'scale(0.96)' },
            ];
      element
        .animate(keyframes, { duration: EXIT_MS, easing: EXIT_EASE, fill: 'forwards' })
        .finished.then(
          () => {
            finish(entry.key);
          },
          () => {
            // Cancelled (the list unmounted): nothing left to tidy.
          },
        );
    });
  }, [entries, exit, finish]);

  /** Spread on each item's own wrapper element. */
  const bind = (entry: PresenceEntry<T>) => ({
    ref: (element: HTMLDivElement | null) => {
      if (element) elements.current.set(entry.key, element);
      else elements.current.delete(entry.key);
    },
    inert: entry.leaving,
    'aria-hidden': entry.leaving ? true : undefined,
    'data-leaving': entry.leaving ? '' : undefined,
  });

  return { entries, bind };
}
