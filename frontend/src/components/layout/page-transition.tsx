import { ViewTransition } from 'react';

/**
 * Transition type for a navigation that changes the URL but not the page — a filter, a sort,
 * a search, a results page. Pass it as `transitionTypes` on the `<Link>` or `router` call and
 * the page stays still while its content updates, instead of fading out and back in.
 */
export const IN_PLACE_NAVIGATION = 'in-place';

/**
 * Route-level enter/exit, with React's `<ViewTransition>` and the browser's View Transitions
 * API (ADR 0015). Every store page — and every route `loading.tsx` skeleton — wraps its
 * content in this, so leaving a page fades it out and the next one (or its skeleton) fades
 * in, and a skeleton hands over to its page the same way when the page streams in.
 *
 * It belongs in pages, not in a layout: a layout persists across navigations, so it never
 * enters or exits. `default="none"` keeps everything else still — content changing inside a
 * page (a Suspense boundary resolving, the cart updating) is not a page change — and so does
 * `IN_PLACE_NAVIGATION`, for URL changes that remount a page without leaving it.
 *
 * The animation itself is CSS (`.page-enter`/`.page-exit` in `globals.css`), compositor-only
 * (opacity and transform), and switched off under `prefers-reduced-motion`. Browsers without
 * view transitions simply swap pages, as they did before.
 *
 * The wrapper `div` keeps one snapshot per page rather than one per top-level element, and
 * carries the `flex-1` column that pages rely on to fill `<main>`.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ [IN_PLACE_NAVIGATION]: 'none', default: 'page-enter' }}
      exit={{ [IN_PLACE_NAVIGATION]: 'none', default: 'page-exit' }}
      default="none"
    >
      <div className="flex flex-1 flex-col">{children}</div>
    </ViewTransition>
  );
}
