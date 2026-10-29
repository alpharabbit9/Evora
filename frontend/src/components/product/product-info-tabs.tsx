'use client';

import { useLenis } from 'lenis/react';
import { useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

export interface ProductInfoTab {
  readonly id: string;
  readonly label: string;
  readonly content: React.ReactNode;
}

/** Clears the sticky site header when a tab is scrolled to. */
const HEADER_OFFSET = 112;

/**
 * The product page's Details / Size & Fit / Shipping tabs, following the WAI-ARIA tabs
 * pattern: one tab stop for the list, arrow keys (and Home/End) move between tabs and
 * activate them.
 *
 * The panels' content is rendered by the Server Component page and passed in; only which one
 * shows lives here. A URL fragment naming a tab (see `product-tab-ids.ts`) opens it and
 * scrolls it into view, on load and whenever the fragment changes.
 */
export function ProductInfoTabs({
  tabs,
  label,
}: {
  tabs: readonly ProductInfoTab[];
  label: string;
}) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '');
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const lenis = useLenis();

  useEffect(() => {
    const openFromHash = () => {
      const id = window.location.hash.slice(1);
      const tab = tabRefs.current.get(id);
      if (!tab) return;

      setActiveId(id);
      if (lenis) {
        lenis.scrollTo(tab, { offset: -HEADER_OFFSET });
      } else {
        tab.scrollIntoView({ block: 'start' });
      }
    };

    // Deferred so the initial open is not a state update during the effect's own commit.
    const frame = window.requestAnimationFrame(openFromHash);
    window.addEventListener('hashchange', openFromHash);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('hashchange', openFromHash);
    };
  }, [lenis]);

  const select = (index: number) => {
    const tab = tabs[(index + tabs.length) % tabs.length];
    if (!tab) return;
    setActiveId(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  };

  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="-mx-4 flex [scrollbar-width:none] gap-6 overflow-x-auto overflow-y-hidden px-4 shadow-[inset_0_-1px_0_var(--border)] sm:mx-0 sm:gap-8 sm:px-0"
      >
        {tabs.map((tab, index) => {
          const active = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(node) => {
                if (node) tabRefs.current.set(tab.id, node);
                else tabRefs.current.delete(tab.id);
              }}
              id={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${tab.id}-panel`}
              tabIndex={active ? 0 : -1}
              onClick={() => {
                setActiveId(tab.id);
              }}
              onKeyDown={(event) => {
                onKeyDown(event, index);
              }}
              className={cn(
                'shrink-0 scroll-mt-28 border-b-2 py-3 text-sm whitespace-nowrap transition-colors',
                // Inset: the scrolling tab strip would clip an outline drawn outside the button.
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                active
                  ? 'border-foreground font-medium text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${tab.id}-panel`}
          role="tabpanel"
          aria-labelledby={tab.id}
          tabIndex={0}
          hidden={tab.id !== activeId}
          className="pt-6 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
