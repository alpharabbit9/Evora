import Link from 'next/link';

import { cn } from '@/lib/utils';

export type SectionIndexItem = {
  href: string;
  label: string;
  /** Marks the page the visitor is on (`aria-current="page"`). */
  current?: boolean;
};

const LINK = cn(
  'group flex items-baseline gap-4 border-b border-border py-3 text-sm text-foreground/75',
  'transition-colors duration-200 hover:text-foreground',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
);

/** An underline that draws in under the text on hover, as on the product card's name. */
const DRAW_UNDERLINE =
  'bg-linear-to-r from-current to-current bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:bg-[length:100%_1px] motion-reduce:transition-none';

/**
 * A ruled list of links under a small label: the "index strip" archetype of the home page
 * (plan.md §D), for the help pages' "On this page" and "Help" lists and the account page's
 * sections. `numbered` prefixes each link with a Geist Mono figure (01, 02, …).
 *
 * In-page anchors (`#…`) are plain `<a>`s, so the browser moves focus and honours the target's
 * `scroll-margin`; other pages go through `next/link`. Hover only draws an underline (CSS); there
 * is nothing to animate in or out.
 */
export function SectionIndex({
  label,
  items,
  numbered = false,
  className,
}: {
  label: string;
  items: readonly SectionIndexItem[];
  numbered?: boolean;
  className?: string;
}) {
  const List = numbered ? 'ol' : 'ul';
  return (
    <nav aria-label={label} className={className}>
      <p
        aria-hidden="true"
        className="border-b border-border pb-3 text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase"
      >
        {label}
      </p>
      <List>
        {items.map((item, index) => {
          const content = (
            <>
              {numbered ? (
                <span
                  aria-hidden="true"
                  className="font-mono text-[11px] text-muted-foreground tabular-nums"
                >
                  {String(index + 1).padStart(2, '0')}
                </span>
              ) : null}
              <span className={cn(DRAW_UNDERLINE, item.current && 'bg-[length:100%_1px]')}>
                {item.label}
              </span>
              {item.current ? (
                <span
                  aria-hidden="true"
                  className="ml-auto size-1.5 self-center rounded-full bg-current"
                />
              ) : null}
            </>
          );
          const className = cn(LINK, item.current && 'text-foreground');
          return (
            <li key={item.href}>
              {item.href.startsWith('#') ? (
                <a href={item.href} className={className}>
                  {content}
                </a>
              ) : (
                <Link
                  href={item.href}
                  aria-current={item.current ? 'page' : undefined}
                  className={className}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </List>
    </nav>
  );
}
