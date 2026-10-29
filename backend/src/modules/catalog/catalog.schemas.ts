import { z } from 'zod';

import { MAX_PAGE_SIZE, paginationQuery, slug } from '../../http/schemas.js';

/**
 * Query shapes for the public catalog (API_SPEC.md §4).
 *
 * Every object is a `strictObject`: an unknown filter key is a 400 rather than a silently
 * ignored parameter, so a misspelt `?colour=` shows up as an error instead of an unfiltered
 * listing that looks like it worked.
 *
 * Values only ever reach the database as bound parameters or as members of the allow-listed
 * enums below (`catalog.query.ts`); none of them is interpolated into SQL.
 */

/** Storefront-facing gender values. `men`/`women` include unisex items (`catalog.query.ts`). */
export const GENDERS = ['men', 'women', 'unisex'] as const;
export type GenderFilter = (typeof GENDERS)[number];

/**
 * `popularity` and `rating` from API_SPEC.md §4 are not offered: there is no data behind them.
 * Without `sort`, a search is ordered by `relevance` and a plain listing by `featured`
 * (front-runners by `featured_rank`, then newest — ADR 0013).
 */
export const PRODUCT_SORTS = [
  'relevance',
  'featured',
  'newest',
  'price_asc',
  'price_desc',
  'name_asc',
] as const;
export type ProductSort = (typeof PRODUCT_SORTS)[number];

export const DEFAULT_PRODUCT_PAGE_SIZE = 24;

/** Comma-separated list (`?color=Black,Navy Blue`), trimmed, de-duplicated and capped. */
const csvList = (maxItems: number, maxLength: number) =>
  z
    .string()
    .max(maxItems * (maxLength + 1))
    .transform((value) => [
      ...new Set(
        value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    ])
    .pipe(z.array(z.string().max(maxLength)).min(1).max(maxItems));

/** Money in the query is integer MINOR units (poisha), like everywhere else (ADR 0008). */
const minorAmount = z.coerce.number().int().min(0).max(2_000_000_000);

const searchText = z.string().trim().min(1).max(100);

/** Filters that decide which products are in scope, shared by the listing and the facets. */
const scopeFilters = {
  q: searchText.optional(),
  category: slug.optional(),
  gender: z.enum(GENDERS).optional(),
};

export const productListQuery = z
  .strictObject({
    ...scopeFilters,
    brand: csvList(10, 80).optional(),
    color: csvList(12, 40).optional(),
    size: csvList(20, 20)
      .transform((sizes) => [...new Set(sizes.map((size) => size.toUpperCase()))])
      .optional(),
    minPrice: minorAmount.optional(),
    maxPrice: minorAmount.optional(),
    inStock: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    sort: z.enum(PRODUCT_SORTS).optional(),
    page: paginationQuery.shape.page,
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PRODUCT_PAGE_SIZE),
  })
  .refine(
    (value) =>
      value.minPrice === undefined ||
      value.maxPrice === undefined ||
      value.minPrice <= value.maxPrice,
    { message: 'minPrice must not be greater than maxPrice', path: ['minPrice'] },
  );

export type ProductListQuery = z.output<typeof productListQuery>;

export const productFacetsQuery = z.strictObject(scopeFilters);

export type ProductFacetsQuery = z.output<typeof productFacetsQuery>;

export const productSlugParams = z.object({ slug });
