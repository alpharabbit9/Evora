import { Suspense } from 'react';

import type { ListingPreset } from '@/lib/catalog/listing-params';

import { CatalogBrowser } from './catalog-browser';
import { CatalogHeader } from './catalog-header';
import { ListingFallback } from './listing-fallback';

/**
 * A fixed collection — Men, Women, New arrivals — as a page: the preset is part of the route,
 * not a filter the visitor can clear, and every other filter still works on top of it.
 */
export function CollectionPage({
  eyebrow,
  title,
  description,
  preset,
}: {
  eyebrow: string;
  title: string;
  description: string;
  preset: ListingPreset;
}) {
  return (
    <>
      <CatalogHeader eyebrow={eyebrow} title={title} description={description} />
      <Suspense fallback={<ListingFallback />}>
        <CatalogBrowser preset={preset} />
      </Suspense>
    </>
  );
}
