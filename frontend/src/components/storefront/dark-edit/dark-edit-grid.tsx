'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { PRODUCT_GRID, ProductCard, ProductCardSkeleton } from '@/components/catalog/product-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Skeleton } from '@/components/ui/skeleton';
import { BatchReveal } from '@/components/storefront/scroll-motion';
import { catalogKeys, fetchProducts } from '@/lib/catalog/api';
import { cn } from '@/lib/utils';

import { DARK_EDIT_QUERY as QUERY } from './dark-edit-query';

/** The lead tile: half the grid from `lg`, two thirds at `md` (three columns), else full. */
const FEATURE_IMAGE_SIZES = '(min-width: 1024px) 50vw, 100vw';
const FEATURE_IMAGE_SIZES_MD = '(min-width: 1024px) 50vw, (min-width: 768px) 64vw, 100vw';

/** Standard cards: two columns, then three at `md` (with eight cards) and four from `lg`. */
const EDIT_CARD_SIZES = '(min-width: 1024px) 23vw, 48vw';
const EDIT_CARD_SIZES_MD = '(min-width: 1024px) 23vw, (min-width: 768px) 31vw, 48vw';

/**
 * Two columns with the lead tile full width; from `lg`, four columns with the lead tile two by
 * two in the top-left corner.
 *
 * One shared grade for every photo inside the island (`saturate` and `contrast` on each `img`),
 * so shots from different studios read as one edit. It composes with the card's own filters
 * (the sold-out greyscale), because Tailwind builds every filter from per-property variables.
 */
const EDIT_GRADE = '[&_img]:saturate-85 [&_img]:contrast-104';
const EDIT_GRID = cn(
  'grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-12',
  EDIT_GRADE,
);
/** Three columns at `md`, for a lead tile with two cards beside it and rows of three below. */
const EDIT_GRID_MD = cn(EDIT_GRID, 'md:grid-cols-3');

/**
 * Server-rendered with the products already in the cache: `dark-edit.tsx` prefetches this
 * query on the server and hands it over through `HydrationBoundary` (plan.md 9.1), so the
 * cards are in the HTML. If that prefetch failed, the cache is empty and this fetches in the
 * browser instead, with its own loading and error states.
 */
export function DarkEditGrid() {
  const products = useQuery({
    queryKey: catalogKeys.products(QUERY),
    queryFn: ({ signal }) => fetchProducts(QUERY, signal),
  });

  if (products.isPending) return <EditSkeleton />;

  if (products.isError) {
    return (
      <ErrorState
        error={products.error}
        title="We couldn't load the edit"
        onRetry={() => {
          void products.refetch();
        }}
      />
    );
  }

  const items = products.data.items;

  if (items.length === 0) {
    return (
      <EmptyState
        title="The edit is being restocked"
        description="Everything else in the collection is still a click away."
        action={
          <Link
            href="/shop"
            className="border-b border-foreground/30 pb-1 text-[10px] font-semibold tracking-[0.24em] uppercase hover:border-foreground"
          >
            Browse the collection
          </Link>
        }
      />
    );
  }

  // The lead tile needs at least four cards beside it, and the cards after it must fill whole
  // rows of four, or the grid would end in a gap. Too few products: a plain grid instead.
  const regular = Math.floor((items.length - 1) / 4) * 4;

  if (regular < 4) {
    return (
      <BatchReveal as="ul" effect="clip" className={cn(PRODUCT_GRID, EDIT_GRADE)}>
        {items.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} variant="editorial" />
          </li>
        ))}
      </BatchReveal>
    );
  }

  const [lead, ...rest] = items;
  // Three columns at `md` only when two cards beside the lead plus whole rows of three use
  // every card: 8 does (2 + 6), 4 does not.
  const threeAtMd = (regular - 2) % 3 === 0;

  return (
    // The edit's signature entrance, row by row: each photo wipes up into its frame
    // (`ClipReveal`, GSAP `clip-path`) while the frame and caption fade in (GSAP owns each
    // `li`'s opacity). The card's hover motion is CSS on elements inside it. Below the hero, so
    // every image loads lazily.
    <BatchReveal as="ul" effect="clip" className={threeAtMd ? EDIT_GRID_MD : EDIT_GRID}>
      <li className={cn('col-span-2 lg:row-span-2', threeAtMd && 'md:row-span-2')}>
        <ProductCard
          product={lead}
          variant="editorial"
          feature={threeAtMd ? 'md' : 'lg'}
          sizes={threeAtMd ? FEATURE_IMAGE_SIZES_MD : FEATURE_IMAGE_SIZES}
        />
      </li>
      {rest.slice(0, regular).map((product) => (
        <li key={product.id}>
          <ProductCard
            product={product}
            variant="editorial"
            sizes={threeAtMd ? EDIT_CARD_SIZES_MD : EDIT_CARD_SIZES}
          />
        </li>
      ))}
    </BatchReveal>
  );
}

/**
 * The edit's own shape while it loads, so the grid does not jump when the cards arrive. Also
 * the fallback while the server streams the prefetched grid in (`dark-edit.tsx`).
 */
export function EditSkeleton() {
  return (
    <div role="status" aria-live="polite">
      {/* Shaped for the usual nine products (three columns at `md`). */}
      <div className={EDIT_GRID_MD}>
        <div className="col-span-2 flex flex-col gap-4 md:row-span-2" aria-hidden="true">
          <Skeleton className="aspect-[4/5] w-full rounded-md md:aspect-auto md:flex-1" />
          <div className="flex flex-col gap-2 px-0.5">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-4 w-1/6" />
          </div>
        </div>
        {Array.from({ length: 8 }, (_, index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </div>
      <span className="sr-only">Loading the edit</span>
    </div>
  );
}
