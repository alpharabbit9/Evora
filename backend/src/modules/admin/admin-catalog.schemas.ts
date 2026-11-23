import {
  ProductGender,
  ProductImageKind,
  ProductStatus,
  ProductVariantStatus,
} from '@prisma/client';
import { z } from 'zod';

import { opaqueId, paginationQuery, slug } from '../../http/schemas.js';

/**
 * Admin catalog request shapes (API_SPEC.md §8). All bodies are strict: an unknown
 * field is a 400, not a silently ignored key.
 */

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const adminProductListQuery = paginationQuery.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(ProductStatus).optional(),
  categoryId: opaqueId.optional(),
  gender: z.enum(ProductGender).optional(),
});

export type AdminProductListQuery = z.output<typeof adminProductListQuery>;

export const adminProductCreateBody = z.strictObject({
  name: z.string().trim().min(1).max(255),
  slug: slug.optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  categoryId: opaqueId,
  gender: z.enum(ProductGender).nullable().optional(),
  status: z.enum(ProductStatus).default('DRAFT'),
  featuredRank: z.number().int().min(1).nullable().optional(),
});

export type AdminProductCreateBody = z.output<typeof adminProductCreateBody>;

export const adminProductUpdateBody = z.strictObject({
  name: z.string().trim().min(1).max(255).optional(),
  slug: slug.optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  brand: z.string().trim().max(120).nullable().optional(),
  categoryId: opaqueId.optional(),
  gender: z.enum(ProductGender).nullable().optional(),
  status: z.enum(ProductStatus).optional(),
  featuredRank: z.number().int().min(1).nullable().optional(),
});

export type AdminProductUpdateBody = z.output<typeof adminProductUpdateBody>;

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const variantOptions = z
  .record(z.string(), z.string().trim().min(1).max(60))
  .refine((obj) => Object.keys(obj).length > 0, 'At least one option is required');

export const adminVariantCreateBody = z.strictObject({
  sku: z.string().trim().min(1).max(80),
  options: variantOptions,
  priceMinor: z.number().int().min(0).max(2_000_000_000),
  compareAtPriceMinor: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
  stockQuantity: z.number().int().min(0).default(0),
  lowStockThreshold: z.number().int().min(0).default(0),
  weightGrams: z.number().int().min(1).nullable().optional(),
  status: z.enum(ProductVariantStatus).default('ACTIVE'),
});

export type AdminVariantCreateBody = z.output<typeof adminVariantCreateBody>;

export const adminVariantUpdateBody = z.strictObject({
  sku: z.string().trim().min(1).max(80).optional(),
  options: variantOptions.optional(),
  priceMinor: z.number().int().min(0).max(2_000_000_000).optional(),
  compareAtPriceMinor: z.number().int().min(0).max(2_000_000_000).nullable().optional(),
  stockQuantity: z.number().int().min(0).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
  weightGrams: z.number().int().min(1).nullable().optional(),
  status: z.enum(ProductVariantStatus).optional(),
});

export type AdminVariantUpdateBody = z.output<typeof adminVariantUpdateBody>;

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export const adminImageCreateBody = z.strictObject({
  objectKey: z.string().min(1).max(512),
  altText: z.string().trim().min(1).max(500),
  sortOrder: z.number().int().min(0).default(0),
  kind: z.enum(ProductImageKind).default('PHOTO'),
  variantId: opaqueId.nullable().optional(),
  widthPx: z.number().int().min(1).nullable().optional(),
  heightPx: z.number().int().min(1).nullable().optional(),
  byteSize: z.number().int().min(1).nullable().optional(),
  contentType: z.string().max(100).nullable().optional(),
});

export type AdminImageCreateBody = z.output<typeof adminImageCreateBody>;

export const adminImageUpdateBody = z.strictObject({
  altText: z.string().trim().min(1).max(500).optional(),
  sortOrder: z.number().int().min(0).optional(),
  kind: z.enum(ProductImageKind).optional(),
  variantId: opaqueId.nullable().optional(),
});

export type AdminImageUpdateBody = z.output<typeof adminImageUpdateBody>;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const adminCategoryListQuery = paginationQuery.extend({
  q: z.string().trim().min(1).max(120).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type AdminCategoryListQuery = z.output<typeof adminCategoryListQuery>;

export const adminCategoryCreateBody = z.strictObject({
  name: z.string().trim().min(1).max(120),
  slug,
  description: z.string().trim().max(1000).nullable().optional(),
  parentId: opaqueId.nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

export type AdminCategoryCreateBody = z.output<typeof adminCategoryCreateBody>;

export const adminCategoryUpdateBody = z.strictObject({
  name: z.string().trim().min(1).max(120).optional(),
  slug: slug.optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  parentId: opaqueId.nullable().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type AdminCategoryUpdateBody = z.output<typeof adminCategoryUpdateBody>;
