import { Suspense } from 'react';

import { PageTransition } from '@/components/layout/page-transition';
import type { ListingPreset } from '@/lib/catalog/listing-params';

import { CatalogBrowser } from './catalog-browser';
import { CollectionBanner } from './collection-banner';
import type { CollectionKey } from './collection-banners';
import { ListingFallback } from './listing-fallback';

/**
 * A fixed collection — Men, Women, New arrivals — as a page: the preset is part of the route,
 * not a filter the visitor can clear, and every other filter still works on top of it. It opens
 * with the collection's campaign banner (`collection-banners.ts`).
 */
export function CollectionPage({
  collection,
  eyebrow,
  title,
  description,
  preset,
}: {
  collection: CollectionKey;
  eyebrow: string;
  title: string;
  description: string;
  preset: ListingPreset;
}) {
  return (
    <PageTransition>
      <CollectionBanner
        collection={collection}
        eyebrow={eyebrow}
        title={title}
        description={description}
      />
      <Suspense fallback={<ListingFallback />}>
        <CatalogBrowser preset={preset} />
      </Suspense>
    </PageTransition>
  );
}
