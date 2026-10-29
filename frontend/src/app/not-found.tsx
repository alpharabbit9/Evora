import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { StorefrontShell } from '@/components/layout/storefront-shell';

export const metadata: Metadata = {
  title: 'Page not found',
};

/**
 * Handles every unmatched URL and any `notFound()` without a closer boundary. It renders
 * under the root layout only — outside `(store)` — so it mounts the storefront chrome itself
 * to keep the visitor's navigation in place.
 */
export default function NotFound() {
  return (
    <StorefrontShell>
      <section className="flex flex-1 items-center px-5 py-24 sm:px-8 lg:py-32">
        <div className="mx-auto flex w-full max-w-2xl flex-col items-center text-center">
          {/* Digits stay in the body face: the demo display font watermarks them. */}
          <p className="text-[10px] font-semibold tracking-[0.32em] text-muted-foreground uppercase">
            Error 404
          </p>
          <h1 className="mt-6 font-display text-[clamp(1.9rem,6vw,3.75rem)] leading-[0.95] text-balance">
            Page not found
          </h1>
          <p className="mt-6 max-w-md text-sm leading-7 text-muted-foreground sm:text-base">
            The page you were looking for doesn&apos;t exist or has moved.
          </p>
          <Link
            href="/"
            className="group mt-9 inline-flex items-center gap-3 border-b border-foreground/30 pb-1.5 text-[10px] font-semibold tracking-[0.24em] uppercase transition-colors hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <ArrowLeft
              className="size-3.5 transition-transform duration-300 group-hover:-translate-x-1"
              aria-hidden="true"
            />
            Back to home
          </Link>
        </div>
      </section>
    </StorefrontShell>
  );
}
