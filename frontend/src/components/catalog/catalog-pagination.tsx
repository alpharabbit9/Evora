import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** 1 … 4 5 [6] 7 8 … 112 — the current page, two either side, and both ends. */
function pageWindow(current: number, last: number): (number | 'gap')[] {
  const pages = new Set([1, last]);
  for (let page = current - 2; page <= current + 2; page += 1) {
    if (page >= 1 && page <= last) pages.add(page);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];

  for (const [index, page] of sorted.entries()) {
    const previous = sorted[index - 1];
    if (previous !== undefined && page - previous > 1) result.push('gap');
    result.push(page);
  }

  return result;
}

/**
 * Page links, not buttons: each page is a real URL, so it can be opened in a new tab, and
 * following one scrolls to the top of the listing like any navigation.
 */
export function CatalogPagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  hrefFor: (page: number) => string;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));

  if (last <= 1) {
    return null;
  }

  const step = (target: number, label: string, icon: React.ReactNode) =>
    target < 1 || target > last ? (
      <span aria-hidden="true" className="grid size-9 place-items-center text-muted-foreground/40">
        {icon}
      </span>
    ) : (
      <Link
        href={hrefFor(target)}
        aria-label={label}
        className={cn('grid size-9 place-items-center hover:bg-secondary', focusRing)}
      >
        {icon}
      </Link>
    );

  return (
    <nav aria-label="Pagination" className="mt-16 flex flex-col items-center gap-4">
      <ul className="flex items-center gap-1">
        <li>{step(page - 1, 'Previous page', <ChevronLeftIcon className="size-4" />)}</li>
        {pageWindow(page, last).map((entry, index) =>
          entry === 'gap' ? (
            // Phones show only prev, the current page and next; "Page x of y" says the rest.
            <li
              key={`gap-${String(index)}`}
              aria-hidden="true"
              className="px-1 text-muted-foreground max-sm:hidden"
            >
              …
            </li>
          ) : (
            <li key={entry} className="max-sm:[&:not(:has([aria-current]))]:hidden">
              <Link
                href={hrefFor(entry)}
                aria-current={entry === page ? 'page' : undefined}
                aria-label={`Page ${String(entry)}`}
                className={cn(
                  'grid h-9 min-w-9 place-items-center px-2 text-sm tabular-nums',
                  entry === page
                    ? 'bg-foreground text-background'
                    : 'text-foreground/75 hover:bg-secondary hover:text-foreground',
                  focusRing,
                )}
              >
                {entry}
              </Link>
            </li>
          ),
        )}
        <li>{step(page + 1, 'Next page', <ChevronRightIcon className="size-4" />)}</li>
      </ul>
      <p className="text-xs text-muted-foreground tabular-nums">
        Page {page} of {last}
      </p>
    </nav>
  );
}
