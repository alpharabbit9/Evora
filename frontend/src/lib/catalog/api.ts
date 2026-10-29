import { apiGet, apiGetPage, type QueryValue } from '@/lib/api-client';

import type {
  CategoryNode,
  Gender,
  ProductDetail,
  ProductFacets,
  ProductPage,
  ProductSort,
} from './types';

/**
 * Catalog reads, shared by Server Components (product detail) and the client-side listing.
 * Query keys live next to the fetchers so a cache entry and the request that fills it
 * cannot drift apart.
 */

/** The listing's state as the API understands it. Money is minor units, like the API. */
export interface ProductQuery {
  q?: string | undefined;
  category?: string | undefined;
  gender?: Gender | undefined;
  brand?: readonly string[] | undefined;
  color?: readonly string[] | undefined;
  size?: readonly string[] | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  inStock?: boolean | undefined;
  sort?: ProductSort | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

const list = (values: readonly string[] | undefined): string | undefined =>
  values && values.length > 0 ? values.join(',') : undefined;

function toQuery(query: ProductQuery): Record<string, QueryValue> {
  return {
    q: query.q,
    category: query.category,
    gender: query.gender,
    brand: list(query.brand),
    color: list(query.color),
    size: list(query.size),
    minPrice: query.minPrice,
    maxPrice: query.maxPrice,
    inStock: query.inStock === true ? 'true' : undefined,
    sort: query.sort,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export function fetchProducts(query: ProductQuery, signal?: AbortSignal): Promise<ProductPage> {
  return apiGetPage<ProductPage['items'][number]>('/products', {
    query: toQuery(query),
    ...(signal ? { signal } : {}),
  });
}

export function fetchProductFacets(
  scope: Pick<ProductQuery, 'q' | 'category' | 'gender'>,
  signal?: AbortSignal,
): Promise<ProductFacets> {
  return apiGet<ProductFacets>('/products/facets', {
    query: { q: scope.q, category: scope.category, gender: scope.gender },
    ...(signal ? { signal } : {}),
  });
}

export function fetchCategories(signal?: AbortSignal): Promise<CategoryNode[]> {
  return apiGet<CategoryNode[]>('/categories', signal ? { signal } : {});
}

export function fetchProduct(slug: string): Promise<ProductDetail> {
  return apiGet<ProductDetail>(`/products/${encodeURIComponent(slug)}`);
}

export const catalogKeys = {
  products: (query: ProductQuery) => ['catalog', 'products', query] as const,
  facets: (scope: Pick<ProductQuery, 'q' | 'category' | 'gender'>) =>
    ['catalog', 'facets', scope] as const,
  categories: () => ['catalog', 'categories'] as const,
};
