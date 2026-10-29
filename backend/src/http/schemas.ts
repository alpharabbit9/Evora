import { z } from 'zod';

/**
 * Query/param shapes that repeat across the API. Keeping them here is what makes the
 * server-side caps real: a new listing endpoint cannot forget the page-size limit or
 * accept an arbitrary sort expression (API_SPEC.md §1/§4 — allow-list sort values,
 * never interpolate a client-supplied order expression).
 */
export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Query values arrive as strings, hence `coerce`; bounds are enforced server-side. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(DEFAULT_PAGE),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type Pagination = z.output<typeof paginationQuery>;

/** Prisma's `skip`/`take` from a validated page; the only place the offset is computed. */
export function toSkipTake(pagination: Pagination): { skip: number; take: number } {
  return { skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize };
}

/** Pagination half of the collection envelope's `meta` (API_SPEC.md §1). */
export function pageMeta(
  pagination: Pagination,
  total: number,
): { page: number; pageSize: number; total: number } {
  return { page: pagination.page, pageSize: pagination.pageSize, total };
}

/**
 * Allow-listed sort keys. The value is an enum member, so a route maps it to an ORDER BY
 * through its own lookup table and never passes caller text to the database.
 */
export function sortQuery<const T extends readonly [string, ...string[]]>(
  allowed: T,
  fallback: T[number],
) {
  return z.object({ sort: z.enum(allowed).default(fallback) });
}

/**
 * Opaque resource id (API_SPEC.md §1). Matches Prisma `cuid()` and Better Auth ids while
 * rejecting the punctuation an injection or path-traversal attempt would need.
 */
export const opaqueId = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'Must be a valid resource id');

/** `/resource/:id` style params, named per route: `idParams('orderId')`. */
export function idParams<const K extends string>(key: K) {
  return z.object({ [key]: opaqueId } as Record<K, typeof opaqueId>);
}

/** URL slug for public catalog routes. */
export const slug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Must be a lowercase hyphenated slug');

/**
 * Client-supplied key that makes a retried mutation safe to replay (invariant 5,
 * API_SPEC.md §6). Long enough that two unrelated requests will not collide.
 */
export const idempotencyKey = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Must be an opaque idempotency key');
