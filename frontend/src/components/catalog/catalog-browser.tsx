'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SearchXIcon, SlidersHorizontalIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useId, useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { Button } from '@/components/ui/button';
import { catalogKeys, fetchCategories, fetchProductFacets, fetchProducts } from '@/lib/catalog/api';
import {
  type ListingPreset,
  SORTS,
  hasActiveFilters,
  listingHref,
  readListingState,
  toProductQuery,
} from '@/lib/catalog/listing-params';
import type { ProductSort } from '@/lib/catalog/types';
import { cn } from '@/lib/utils';

import { type ListingChanges, CatalogFilters } from './catalog-filters';
import { CatalogPagination } from './catalog-pagination';
import { PRODUCT_GRID, ProductCard, ProductGridSkeleton } from './product-card';

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** Facets and categories change only when the catalog does; products are re-read more often. */
const FACETS_STALE_MS = 5 * 60_000;
const CATEGORIES_STALE_MS = 10 * 60_000;

/**
 * The product listing: filters, sort, grid and pagination over `GET /products`.
 *
 * A Client Component because every interaction is a URL change that should re-query without
 * a full server round trip. The page that mounts it renders the static heading and wraps
 * this in `<Suspense>`, which `useSearchParams` needs under `cacheComponents`.
 *
 * While a new page of results loads, the previous one stays on screen, dimmed and marked
 * busy, instead of collapsing to a skeleton on every click (`keepPreviousData`).
 */
export function CatalogBrowser({ preset = {} }: { preset?: ListingPreset }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();

  const state = readListingState(new URLSearchParams(searchParams.toString()));
  const query = toProductQuery(state, preset);
  const scope = { q: query.q, category: query.category, gender: query.gender };

  const products = useQuery({
    queryKey: catalogKeys.products(query),
    queryFn: ({ signal }) => fetchProducts(query, signal),
    placeholderData: keepPreviousData,
  });

  const facets = useQuery({
    queryKey: catalogKeys.facets(scope),
    queryFn: ({ signal }) => fetchProductFacets(scope, signal),
    placeholderData: keepPreviousData,
    staleTime: FACETS_STALE_MS,
  });

  const categories = useQuery({
    queryKey: catalogKeys.categories(),
    queryFn: ({ signal }) => fetchCategories(signal),
    staleTime: CATEGORIES_STALE_MS,
  });

  const current = new URLSearchParams(searchParams.toString());
  const hrefWith = (changes: ListingChanges) => listingHref(pathname, current, changes);
  const navigate = (changes: ListingChanges) => {
    router.replace(hrefWith(changes), { scroll: false });
  };

  const clearFilters = () => {
    // Keeps the search and the sort; drops everything the panel sets.
    navigate({
      category: undefined,
      gender: undefined,
      brand: undefined,
      color: undefined,
      size: undefined,
      min: undefined,
      max: undefined,
      inStock: undefined,
    });
  };

  const effectiveSort: ProductSort = query.sort ?? (query.q ? 'relevance' : 'featured');
  const filtered = hasActiveFilters({ ...state, gender: preset.gender ? undefined : state.gender });
  const total = products.data?.total;

  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 pb-24 sm:px-6 lg:px-10 xl:px-14">
      <div className="flex flex-wrap items-center justify-between gap-4 border-y border-border py-4">
        <div className="flex items-center gap-5">
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls={filtersId}
            onClick={() => {
              setFiltersOpen((open) => !open);
            }}
            className={cn(
              'inline-flex items-center gap-2 text-[10px] font-semibold tracking-[0.2em] uppercase lg:hidden',
              focusRing,
            )}
          >
            <SlidersHorizontalIcon className="size-4" strokeWidth={1.5} aria-hidden="true" />
            {filtersOpen ? 'Hide filters' : 'Filters'}
          </button>
          <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {total === undefined
              ? 'Loading products'
              : `${total.toLocaleString('en-US')} ${total === 1 ? 'product' : 'products'}`}
          </p>
          {filtered ? (
            <button
              type="button"
              onClick={clearFilters}
              className={cn(
                'border-b border-foreground/30 pb-0.5 text-[10px] font-semibold tracking-[0.2em] uppercase hover:border-foreground',
                focusRing,
              )}
            >
              Clear filters
            </button>
          ) : null}
        </div>

        <label className="flex items-center gap-3 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
          Sort
          <select
            value={effectiveSort}
            onChange={(event) => {
              navigate({ sort: event.target.value });
            }}
            className={cn(
              'border border-border bg-background px-2 py-1.5 text-xs font-normal tracking-normal text-foreground normal-case',
              focusRing,
            )}
          >
            {query.q ? <option value="relevance">Best match</option> : null}
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-8 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-12 xl:grid-cols-[250px_minmax(0,1fr)] xl:gap-16">
        <aside
          id={filtersId}
          aria-label="Filters"
          className={cn('mb-10 lg:mb-0 lg:block', filtersOpen ? 'block' : 'hidden')}
        >
          {facets.isError ? (
            <ErrorState
              error={facets.error}
              title="Filters unavailable"
              className="items-start px-0 py-0 text-left"
              onRetry={() => {
                void facets.refetch();
              }}
            />
          ) : (
            <CatalogFilters
              state={state}
              preset={preset}
              facets={facets.data}
              categories={categories.data}
              onChange={navigate}
            />
          )}
        </aside>

        <section aria-label="Products" aria-busy={products.isFetching}>
          {products.isPending ? (
            <ProductGridSkeleton count={8} />
          ) : products.isError ? (
            <ErrorState
              error={products.error}
              title="We couldn't load products"
              onRetry={() => {
                void products.refetch();
              }}
            />
          ) : products.data.items.length === 0 ? (
            <NoResults
              q={query.q}
              filtered={filtered}
              pageOutOfRange={products.data.total > 0}
              firstPageHref={hrefWith({ page: 1 })}
              onClear={clearFilters}
            />
          ) : (
            <>
              <ul
                className={cn(
                  PRODUCT_GRID,
                  'transition-opacity duration-200',
                  products.isPlaceholderData && 'opacity-60',
                )}
              >
                {products.data.items.map((product, index) => (
                  <li key={product.id}>
                    <ProductCard product={product} preload={index < 4 && state.page === 1} />
                  </li>
                ))}
              </ul>
              <CatalogPagination
                page={products.data.page}
                pageSize={products.data.pageSize}
                total={products.data.total}
                hrefFor={(page) => hrefWith({ page })}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function NoResults({
  q,
  filtered,
  pageOutOfRange,
  firstPageHref,
  onClear,
}: {
  q: string | undefined;
  filtered: boolean;
  pageOutOfRange: boolean;
  firstPageHref: string;
  onClear: () => void;
}) {
  if (pageOutOfRange) {
    return (
      <EmptyState
        title="This page is empty"
        description="There are fewer products than this page number."
        action={
          <Link
            href={firstPageHref}
            className="border-b border-foreground/30 pb-0.5 text-[10px] font-semibold tracking-[0.2em] uppercase hover:border-foreground"
          >
            Back to page 1
          </Link>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={<SearchXIcon className="size-6" strokeWidth={1.25} />}
      title={q ? `No results for “${q}”` : 'No products match'}
      description={
        filtered
          ? 'Try removing a filter or two.'
          : q
            ? 'Check the spelling or try a broader word, like “boots” or “jacket”.'
            : 'There is nothing in this collection yet.'
      }
      action={
        filtered ? (
          <Button variant="outline" size="sm" className="rounded-none" onClick={onClear}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}
