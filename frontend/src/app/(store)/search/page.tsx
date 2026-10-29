import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CatalogBrowser } from '@/components/catalog/catalog-browser';
import { CatalogHeader } from '@/components/catalog/catalog-header';
import { ListingFallback } from '@/components/catalog/listing-fallback';
import { SearchBox } from '@/components/catalog/search-box';

export const metadata: Metadata = {
  title: 'Search',
  // Result pages are thin and endless; keep them out of the index.
  robots: { index: false },
};

/**
 * `/search?q=…` — the same listing as `/shop`, ordered by relevance when there is a query.
 * Without one it shows the whole catalog, so the page is never a dead end.
 */
export default function SearchPage() {
  return (
    <>
      <CatalogHeader eyebrow="Search" title="Find a piece">
        <Suspense
          fallback={<div className="mt-8 h-[53px] max-w-2xl border-b border-foreground/40" />}
        >
          <SearchBox />
        </Suspense>
      </CatalogHeader>
      <Suspense fallback={<ListingFallback />}>
        <CatalogBrowser />
      </Suspense>
    </>
  );
}
