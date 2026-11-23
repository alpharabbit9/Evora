'use client';

import { useLenis } from 'lenis/react';
import { useRef, useState, useSyncExternalStore } from 'react';

/** The element a page marks to say "hide the header on scroll-down once this is behind you". */
const MARKER = '[data-header-autohide]';

/** Scroll travel, in px, one way before the header reacts: ignores trackpad jitter. */
const TRAVEL = 12;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(onChange: () => void) {
  const query = matchMedia(REDUCED_MOTION);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function useReducedMotionPreference(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * plan.md 2.6: whether the sticky header should slide out of view.
 *
 * Only on a page that opts in by marking an element with `data-header-autohide` (the home
 * hero), and only once that element has scrolled fully behind the header: scrolling down hides
 * the header, any scroll up brings it back. Pages without the marker (product, bag, checkout,
 * orders, whose sticky summaries sit at `top-28` under the header) never hide it; on a new
 * route the marker is gone, and the scroll to the top that comes with navigation shows it.
 *
 * Never while `paused` (the menu is open), and never under reduced motion. Keyboard focus
 * inside the header shows it through CSS (`has-[:focus-visible]`), not through this hook.
 *
 * Driven by Lenis' scroll callback, so it runs in the frame Lenis moved the page, for wheel,
 * keyboard and scrollbar scrolling alike. It deliberately avoids `usePathname`: the header
 * renders outside any `<Suspense>`, which `cacheComponents` requires for that hook.
 */
export function useHeaderAutohide(paused: boolean): boolean {
  const reducedMotion = useReducedMotionPreference();
  const [hidden, setHidden] = useState(false);
  const travel = useRef(0);
  const lastScroll = useRef<number | null>(null);

  const active = !paused && !reducedMotion;

  useLenis(
    (lenis) => {
      const previous = lastScroll.current;
      lastScroll.current = lenis.scroll;
      const marker = active ? document.querySelector(MARKER) : null;
      const pastMarker = marker !== null && marker.getBoundingClientRect().bottom <= 0;
      if (!pastMarker || previous === null) {
        travel.current = 0;
        setHidden(false);
        return;
      }
      const delta = lenis.scroll - previous;
      if (delta === 0) return;
      // Restart the count whenever the direction flips.
      travel.current =
        Math.sign(delta) === Math.sign(travel.current) ? travel.current + delta : delta;
      if (travel.current > TRAVEL) setHidden(true);
      else if (travel.current < -TRAVEL) setHidden(false);
    },
    [active],
  );

  // The menu opening and reduced motion switching on show it at once.
  return hidden && active;
}
