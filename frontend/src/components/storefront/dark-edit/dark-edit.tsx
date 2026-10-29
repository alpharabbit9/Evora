import Link from 'next/link';

import { SectionHeading } from '@/components/storefront/section-heading';

import { DarkEditGrid } from './dark-edit-grid';

const HEADING_ID = 'dark-edit-heading';

/**
 * "The Dark Edit": the store's front-runners — leather, bombers, blazers, coats, boots and
 * hoodies — straight under the hero. Products come from `GET /products?sort=featured`, the
 * same order `/shop` uses by default (backend `featured_rank`, ADR 0013), so this is a window
 * onto the catalog rather than a second, hand-kept list.
 *
 * A Server Component for the heading and link; only the grid fetches in the browser.
 */
export function DarkEdit() {
  return (
    <section aria-labelledby={HEADING_ID} className="bg-background text-foreground">
      <div className="mx-auto w-full max-w-[1680px] px-4 pt-[clamp(3rem,2rem+3vw,5rem)] pb-[clamp(2rem,1rem+3vw,4rem)] sm:px-6 lg:px-10 xl:px-14">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-6 sm:mb-12">
          <SectionHeading
            id={HEADING_ID}
            eyebrow="The Dark Edit"
            title="Built for the After Hours"
          />
          <Link
            href="/shop"
            className="border-b border-foreground/30 pb-1.5 text-[10px] font-semibold tracking-[0.24em] uppercase hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            Shop the edit
          </Link>
        </div>
        <DarkEditGrid />
      </div>
    </section>
  );
}
