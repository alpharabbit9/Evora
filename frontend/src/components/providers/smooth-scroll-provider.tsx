'use client';

import { ReactLenis } from 'lenis/react';

/**
 * Smooth scrolling for the document scroller.
 *
 * `root` tells Lenis to drive the window instead of a wrapper element, so it renders no
 * extra DOM and the layout's flex column, `position: sticky` headers, and `100dvh`
 * measurements keep behaving as they do without it.
 *
 * Accessibility is handled by Lenis' own `respectReducedMotion` (on by default): under
 * `prefers-reduced-motion: reduce` it forces `lerp: 1` so scrolling tracks the wheel 1:1
 * and programmatic scrolls jump instantly. Do not disable it — hijacked scrolling is the
 * motion WCAG 2.3.3 is about.
 */
export function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
  return (
    <ReactLenis
      root
      options={{
        // Dialogs, drawers, and the cart sheet lock the page by setting `overflow` on
        // <html>. Lenis would otherwise keep its own wheel handling alive underneath and
        // scroll the page behind the overlay; `autoToggle` stops and restarts it with
        // that overflow change. The 1ms `transition-behavior` hook it listens for ships
        // in lenis.css, imported from globals.css.
        autoToggle: true,
        // Without this, clicking a link mid-flick carries the leftover inertia into the
        // next route and the new page drifts after it has already rendered.
        stopInertiaOnNavigate: true,
      }}
    >
      {children}
    </ReactLenis>
  );
}
