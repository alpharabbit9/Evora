import { ArrowLeft, ArrowUpRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Fragment } from 'react';

import { COLLECTION_LINKS } from '@/components/catalog/collection-banners';
import { PageTransition } from '@/components/layout/page-transition';
import { StorefrontShell } from '@/components/layout/storefront-shell';
import { ENTER } from '@/lib/motion/enter';
import { cn } from '@/lib/utils';

const TITLE_WORDS = ['Page', 'not', 'found'] as const;

/** Gap between one title word rising and the next. */
const WORD_STAGGER_MS = 80;

export const metadata: Metadata = {
  title: 'Page not found',
};

/**
 * Handles every unmatched URL and any `notFound()` without a closer boundary. It renders
 * under the root layout only — outside `(store)` — so it mounts the storefront chrome itself
 * to keep the visitor's navigation in place.
 *
 * It offers a way on into the store, not only back home: the collections, as the listing
 * banner's switcher does. Entrance (CSS, `lib/motion/enter.ts`): each word of the title rises
 * out of its own mask, echoing the footer wordmark, then the copy and links fade up. Reduced
 * motion: none.
 */
export default function NotFound() {
  return (
    <StorefrontShell>
      <PageTransition>
        <section className="flex flex-1 items-center px-5 py-24 sm:px-8 lg:py-32">
          <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
            {/* Digits stay in the body face: the demo display font watermarks them. */}
            <p
              className={cn(
                ENTER,
                'text-[10px] font-semibold tracking-[0.32em] text-muted-foreground uppercase slide-in-from-bottom-2',
              )}
            >
              Error 404
            </p>
            <h1 className="mt-6 font-display text-[clamp(1.9rem,6vw,3.75rem)] leading-[0.95] text-balance">
              {TITLE_WORDS.map((word, index) => (
                // Each word rises through its own clip; the padding, cancelled by the margin,
                // keeps the mask clear of the glyphs at rest. The space sits between the clips,
                // so the title still wraps between words.
                <Fragment key={word}>
                  {index > 0 ? ' ' : null}
                  <span className="-my-[0.12em] inline-block overflow-hidden py-[0.12em] align-bottom">
                    <span
                      className={cn(ENTER, 'inline-block slide-in-from-bottom-full')}
                      style={{ animationDelay: `${String(100 + index * WORD_STAGGER_MS)}ms` }}
                    >
                      {word}
                    </span>
                  </span>
                </Fragment>
              ))}
            </h1>
            <p
              className={cn(
                ENTER,
                'mt-6 max-w-md text-sm leading-7 text-muted-foreground delay-500 slide-in-from-bottom-3 sm:text-base',
              )}
            >
              The page you were looking for doesn&apos;t exist or has moved.
            </p>
            <nav
              aria-label="Collections"
              className={cn(ENTER, 'mt-9 delay-[600ms] slide-in-from-bottom-3')}
            >
              <ul className="flex flex-wrap justify-center gap-2">
                {COLLECTION_LINKS.map((link) => (
                  <li key={link.key}>
                    <Link
                      href={link.href}
                      className="group inline-flex h-10 items-center gap-1.5 rounded-full border border-foreground/25 px-4 text-[10px] font-semibold tracking-[0.2em] uppercase transition-[background-color,border-color,color] duration-300 hover:border-foreground hover:bg-foreground hover:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {link.label}
                      <ArrowUpRight
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="-mr-1 size-3.5 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 motion-reduce:transition-none"
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <Link
              href="/"
              className={cn(
                ENTER,
                'group mt-9 inline-flex items-center gap-3 border-b border-foreground/30 pb-1.5 text-[10px] font-semibold tracking-[0.24em] uppercase transition-colors delay-700 slide-in-from-bottom-2 hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
              )}
            >
              <ArrowLeft
                className="size-3.5 transition-transform duration-300 group-hover:-translate-x-1"
                aria-hidden="true"
              />
              Back to home
            </Link>
          </div>
        </section>
      </PageTransition>
    </StorefrontShell>
  );
}
