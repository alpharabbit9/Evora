import type { ProductQuery } from './api';
import type { Gender, ProductSort } from './types';

/**
 * The listing's filters live in the URL, so a filtered page can be shared, bookmarked and
 * reached with Back. This module is the only translation between the URL and the API query.
 *
 * Prices in the URL are whole taka (`?min=2000`) because people read and edit them; the API
 * takes minor units, so the conversion happens here and nowhere else. Anything unparseable is
 * dropped rather than sent: the API would reject it, and a hand-edited URL should degrade to
 * an unfiltered page, not an error.
 */
export const LISTING_PAGE_SIZE = 24;

const GENDERS: readonly Gender[] = ['men', 'women', 'unisex'];
export const SORTS: readonly { value: ProductSort; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'newest', label: 'Newest' },
  { value: 'price_asc', label: 'Price: low to high' },
  { value: 'price_desc', label: 'Price: high to low' },
  { value: 'name_asc', label: 'Name: A–Z' },
];

/** A preset fixed by the route (`/collections/men`) rather than chosen in the filters. */
export interface ListingPreset {
  readonly gender?: Gender;
  readonly sort?: ProductSort;
}

export interface ListingState {
  readonly q: string | undefined;
  readonly category: string | undefined;
  readonly gender: Gender | undefined;
  readonly brand: string[];
  readonly color: string[];
  readonly size: string[];
  /** Whole taka. */
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly inStock: boolean;
  readonly sort: ProductSort | undefined;
  readonly page: number;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function csv(value: string | null): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].slice(0, 10);
}

function wholeNumber(value: string | null): number | undefined {
  if (value === null || !/^\d{1,8}$/.test(value)) return undefined;
  return Number(value);
}

export function readListingState(params: URLSearchParams): ListingState {
  const q = params.get('q')?.trim().slice(0, 100);
  const category = params.get('category') ?? undefined;
  const gender = params.get('gender') as Gender | null;
  const sort = params.get('sort') as ProductSort | null;
  const page = wholeNumber(params.get('page'));

  return {
    q: q ? q : undefined,
    category: category && SLUG.test(category) ? category : undefined,
    gender: gender && GENDERS.includes(gender) ? gender : undefined,
    brand: csv(params.get('brand')),
    color: csv(params.get('color')),
    size: csv(params.get('size')),
    min: wholeNumber(params.get('min')),
    max: wholeNumber(params.get('max')),
    inStock: params.get('inStock') === 'true',
    sort:
      sort && (sort === 'relevance' || SORTS.some((option) => option.value === sort))
        ? sort
        : undefined,
    page: page && page >= 1 ? page : 1,
  };
}

export function toProductQuery(state: ListingState, preset: ListingPreset = {}): ProductQuery {
  const min = state.min;
  const max = state.max;
  // A reversed range is the visitor's typo, not a request for nothing.
  const [low, high] = min !== undefined && max !== undefined && min > max ? [max, min] : [min, max];

  return {
    q: state.q,
    category: state.category,
    gender: preset.gender ?? state.gender,
    brand: state.brand,
    color: state.color,
    size: state.size,
    minPrice: low === undefined ? undefined : low * 100,
    maxPrice: high === undefined ? undefined : high * 100,
    inStock: state.inStock || undefined,
    sort: state.sort ?? preset.sort,
    page: state.page,
    pageSize: LISTING_PAGE_SIZE,
  };
}

/**
 * The URL for a changed listing. Any filter change returns to page 1; only an explicit page
 * change keeps a page number.
 */
export function listingHref(
  pathname: string,
  current: URLSearchParams,
  changes: Record<string, string | readonly string[] | number | boolean | undefined>,
): string {
  const next = new URLSearchParams(current);

  for (const [key, value] of Object.entries(changes)) {
    const serialised = Array.isArray(value)
      ? value.join(',')
      : value === undefined || value === false
        ? ''
        : String(value);

    if (serialised === '' || (key === 'page' && serialised === '1')) {
      next.delete(key);
    } else {
      next.set(key, serialised);
    }
  }

  if (!('page' in changes)) {
    next.delete('page');
  }

  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export function hasActiveFilters(state: ListingState): boolean {
  return (
    state.category !== undefined ||
    state.gender !== undefined ||
    state.brand.length > 0 ||
    state.color.length > 0 ||
    state.size.length > 0 ||
    state.min !== undefined ||
    state.max !== undefined ||
    state.inStock
  );
}
