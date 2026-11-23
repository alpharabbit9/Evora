'use client';

import { useLayoutEffect, useRef } from 'react';

import {
  EASE_OUT,
  gsap,
  MOTION_QUERIES,
  REVEAL,
  REVEAL_START,
  useScrollTriggerAutoRefresh,
} from '@/lib/motion/gsap';
import { cn } from '@/lib/utils';

/**
 * Scroll-triggered entrance for storefront sections: the first time a `RevealGroup` scrolls
 * into view, one GSAP timeline plays across everything marked inside it — each `RevealItem`
 * fades up in render order, `RevealLine` headings rise out of their masks just behind, and
 * `RevealRule` hairlines draw out from their leading edge. Marks may sit at any depth inside
 * the group, including inside other Client Components; the group finds them by data attribute.
 *
 * Property ownership (ADR 0010): GSAP owns `opacity` and `transform` (`y`, or `x` with
 * `items="slide"`) on every `RevealItem`,
 * the transform of a `RevealLine`'s inner span and of a `RevealRule`. Nothing else may animate
 * those on the same element: put CSS hover movement on a child instead. Under reduced motion
 * the items fade without travel, and lines and rules appear in place.
 *
 * The starting state is applied in a layout effect, before the first client paint. Content is
 * in the server HTML fully visible, so without JavaScript nothing stays hidden.
 *
 * Server Components can pass their markup straight in as `children`; only the group's effect
 * ships to the browser.
 *
 * `items` picks the items' entrance, so neighbouring sections need not share one (plan.md
 * Phase 5, "one signature per section"):
 * - `rise` (default): fade up `REVEAL.y`.
 * - `slide`: arrive along the row from the right, `REVEAL.slideX`, a short stagger apart. For a
 *   horizontal row of pieces (Recent Arrivals).
 * - `fade`: opacity only, in place. For quiet content such as quotes.
 * - `false`: items do not move at all. Only the masked lines and rules play, for sections
 *   whose content should simply be there (the service strip, the FAQ).
 * Under reduced motion every mode except `false` is the same plain fade.
 */

const SELECTOR = {
  item: '[data-reveal="item"]',
  line: '[data-reveal="line"]',
  rule: '[data-reveal="rule"]',
} as const;

type RevealProps = {
  className?: string;
  children: React.ReactNode;
};

export type RevealItems = 'rise' | 'slide' | 'fade' | false;

export function RevealGroup({
  className,
  children,
  items = 'rise',
}: RevealProps & { items?: RevealItems }) {
  const ref = useRef<HTMLDivElement>(null);
  useScrollTriggerAutoRefresh();

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const q = gsap.utils.selector(root);
    const mm = gsap.matchMedia();

    mm.add(MOTION_QUERIES, (context) => {
      const reduced = Boolean(context.conditions?.reduced);
      // Once: content that has been read must not hide again when scrolled back past.
      const tl = gsap.timeline({
        defaults: { ease: EASE_OUT },
        scrollTrigger: { trigger: root, start: REVEAL_START, once: true },
      });

      // A group need not contain every kind of mark; GSAP warns about empty targets.
      const from = (selector: string, vars: gsap.TweenVars, position: number) => {
        const targets = q(selector);
        if (targets.length > 0) tl.from(targets, vars, position);
      };

      if (reduced) {
        if (items === false) return;
        from(
          SELECTOR.item,
          {
            opacity: 0,
            duration: REVEAL.fadeDuration,
            stagger: REVEAL.fadeStagger,
            ease: 'none',
          },
          0,
        );
        return;
      }

      if (items === 'rise') {
        from(
          SELECTOR.item,
          { opacity: 0, y: REVEAL.y, duration: REVEAL.duration, stagger: REVEAL.stagger },
          0,
        );
      } else if (items === 'slide') {
        from(
          SELECTOR.item,
          {
            opacity: 0,
            x: REVEAL.slideX,
            duration: REVEAL.duration,
            stagger: REVEAL.slideStagger,
          },
          0,
        );
      } else if (items === 'fade') {
        from(
          SELECTOR.item,
          {
            opacity: 0,
            duration: REVEAL.duration,
            stagger: REVEAL.stagger,
            ease: 'power1.out',
          },
          0,
        );
      }
      from(
        SELECTOR.line,
        { yPercent: 110, duration: REVEAL.lineDuration, stagger: REVEAL.lineStagger },
        0.06,
      );
      from(
        SELECTOR.rule,
        {
          scaleX: 0,
          transformOrigin: 'left center',
          duration: REVEAL.ruleDuration,
          ease: 'power3.inOut',
        },
        0.12,
      );
    });

    return () => mm.revert();
  }, [items]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

export function RevealItem({
  as = 'div',
  className,
  children,
}: RevealProps & { as?: 'div' | 'li' }) {
  const Tag = as;
  return (
    <Tag data-reveal="item" className={className}>
      {children}
    </Tag>
  );
}

/**
 * Text that rises into view from behind a clip, for headings inside a `RevealGroup`. The clip
 * is padded and pulled back by the same amount, so descenders are not cut off and the line
 * box does not change. Outside a group it simply renders in place.
 */
export function RevealLine({ children }: { children: React.ReactNode }) {
  return (
    <span className="-mb-[0.12em] block overflow-hidden pb-[0.12em]">
      <span data-reveal="line" className="block">
        {children}
      </span>
    </span>
  );
}

/**
 * A decorative rule that draws itself in with its group. Size and colour come from
 * `className`.
 */
export function RevealRule({ className }: { className?: string }) {
  return <span aria-hidden="true" data-reveal="rule" className={cn('block', className)} />;
}
