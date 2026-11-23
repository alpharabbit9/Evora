import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';

import { Container } from '@/components/layout/container';
import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { SectionHeading } from '@/components/storefront/section-heading';
import { catalogKeys, fetchProducts } from '@/lib/catalog/api';

import { DarkEditGrid, EditSkeleton } from './dark-edit-grid';
import { DARK_EDIT_QUERY } from './dark-edit-query';

const HEADING_ID = 'dark-edit-heading';

/**
 * How long the server waits for the API before it gives up and lets the browser fetch. The
 * rest of the page is already on screen by then (this streams inside `<Suspense>`); the limit
 * only stops a slow API from holding the response open.
 */
const PREFETCH_TIMEOUT_MS = 3000;

/**
 * The grid with its products fetched on the server (plan.md 9.1), so the cards are in the
 * HTML for search engines and appear without a second round trip from the browser.
 *
 * Read at request time, like the product page: prices and stock must be current, so nothing is
 * cached (architecture.md §10). `connection()` marks that for `cacheComponents` before the
 * query client reads the clock; the home page's static shell is still prerendered, and this
 * part streams in. A failed or slow read is not an error here: `prefetchQuery` never throws,
 * `dehydrate` leaves failed queries out, and the grid then fetches in the browser with its own
 * loading, error and retry states.
 */
async function PrefetchedGrid() {
  await connection();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await queryClient.prefetchQuery({
    queryKey: catalogKeys.products(DARK_EDIT_QUERY),
    queryFn: () => fetchProducts(DARK_EDIT_QUERY, AbortSignal.timeout(PREFETCH_TIMEOUT_MS)),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <DarkEditGrid />
    </HydrationBoundary>
  );
}

/**
 * "The Dark Edit": the store's front-runners — leather, bombers, blazers, coats, boots and
 * hoodies — straight under the hero. Products come from `GET /products?sort=featured`, the
 * same order `/shop` uses by default (backend `featured_rank`, ADR 0013), so this is a window
 * onto the catalog rather than a second, hand-kept list.
 *
 * The section is the page's first dark chapter: a full-bleed theme island (`dark`), so its
 * tokens are light-on-dark in either site theme. In the dark site theme the island is the page's
 * own colour, so hairlines above and below keep the chapter's edges. `data-band` marks it as a
 * full-bleed band, so the framed campaign after it adds the top spacing a band needs.
 *
 * Opens with the `inline` heading archetype (name, aside and link on one line), so it does not
 * repeat the rail's editorial opener above it.
 *
 * A Server Component for the heading and link, and for the products, which it fetches on the
 * server and streams in (`PrefetchedGrid`). The heading row reveals with `RevealGroup`; the
 * cards come in by row with GSAP, each photo wiping up into its frame (`BatchReveal
 * effect="clip"`, in the grid).
 */
export function DarkEdit() {
  return (
    <section
      data-band
      aria-labelledby={HEADING_ID}
      className="dark bg-background text-foreground [html.dark_&]:border-y [html.dark_&]:border-border"
    >
      <Container className="py-section-lg">
        <RevealGroup className="mb-10 sm:mb-12">
          <RevealItem>
            <SectionHeading
              variant="inline"
              id={HEADING_ID}
              title="The Dark Edit"
              aside="built for the after hours"
              action={
                // The underline sweeps in from the left on hover and out to the right after;
                // the link's own motion is CSS.
                <Link
                  href="/shop"
                  className="group tap-target inline-flex shrink-0 items-center gap-2.5 border-b border-foreground/25 pb-1.5 text-[10px] font-semibold tracking-[0.24em] uppercase after:absolute after:inset-x-0 after:-bottom-px after:h-px after:origin-right after:scale-x-0 after:bg-foreground after:transition-transform after:duration-500 after:ease-[cubic-bezier(0.16,1,0.3,1)] hover:after:origin-left hover:after:scale-x-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:after:transition-none"
                >
                  Shop the edit
                  <ArrowRight
                    aria-hidden="true"
                    strokeWidth={1.5}
                    className="size-3.5 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1 motion-reduce:transition-none"
                  />
                </Link>
              }
            />
          </RevealItem>
        </RevealGroup>
        <Suspense fallback={<EditSkeleton />}>
          <PrefetchedGrid />
        </Suspense>
      </Container>
    </section>
  );
}
