import { randomUUID } from 'node:crypto';

import type { ProductGender, ProductStatus, ProductVariantStatus } from '@prisma/client';

import { prisma } from '../../src/lib/prisma.js';

/**
 * Catalog rows for the catalog and cart integration suites, written with Prisma because there
 * is no admin catalog API yet. Each helper builds the smallest valid row and lets a test
 * override exactly the property it is about — the status, the image, the category — so a
 * hidden product differs from a visible one in one field only.
 */

export async function makeCategory(
  slug: string,
  options: { parentId?: string; isActive?: boolean; name?: string } = {},
) {
  return prisma.category.create({
    data: {
      slug,
      name: options.name ?? slug.replace(/-/g, ' '),
      isActive: options.isActive ?? true,
      ...(options.parentId ? { parentId: options.parentId } : {}),
    },
  });
}

export interface VariantSpec {
  readonly color?: string;
  readonly size?: string;
  readonly priceMinor?: number;
  readonly stockQuantity?: number;
  readonly lowStockThreshold?: number;
  readonly status?: ProductVariantStatus;
}

export interface ProductSpec {
  readonly categoryId: string;
  readonly name?: string;
  readonly brand?: string | null;
  readonly description?: string | null;
  readonly gender?: ProductGender | null;
  readonly status?: ProductStatus;
  readonly publishedAt?: Date | null;
  /** Number of images; 0 makes a product that fails the publication rule. */
  readonly images?: number;
  readonly variants?: readonly VariantSpec[];
  readonly provenance?: boolean;
  readonly featuredRank?: number;
}

export async function makeProduct(spec: ProductSpec) {
  const suffix = randomUUID().slice(0, 8);
  const name = spec.name ?? `Product ${suffix}`;
  const slug = `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}-${suffix}`;
  const status = spec.status ?? 'PUBLISHED';

  const product = await prisma.product.create({
    data: {
      name,
      slug,
      brand: spec.brand === undefined ? 'Test Brand' : spec.brand,
      description: spec.description ?? null,
      categoryId: spec.categoryId,
      gender: spec.gender === undefined ? 'MEN' : spec.gender,
      status,
      featuredRank: spec.featuredRank ?? null,
      publishedAt:
        spec.publishedAt !== undefined
          ? spec.publishedAt
          : status === 'PUBLISHED'
            ? new Date(Date.now() - 60_000)
            : null,
      ...(spec.provenance
        ? {
            sourceProvider: 'test-provider',
            sourceExternalId: suffix,
            sourceUrl: `https://source.example/${suffix}`,
            sourceContentHash: 'f'.repeat(64),
          }
        : {}),
    },
  });

  const variants = [];
  for (const [index, variant] of (spec.variants ?? [{}]).entries()) {
    const options: Record<string, string> = { color: variant.color ?? 'Black' };
    if (variant.size) options.size = variant.size;

    variants.push(
      await prisma.productVariant.create({
        data: {
          productId: product.id,
          sku: `TST-${suffix}-${String(index)}`.toUpperCase(),
          optionKey: Object.entries(options)
            .map(([key, value]) => `${key}:${value.toLowerCase()}`)
            .join('|'),
          options,
          priceMinor: variant.priceMinor ?? 250_000,
          priceSource: 'SYNTHETIC',
          stockQuantity: variant.stockQuantity ?? 10,
          lowStockThreshold: variant.lowStockThreshold ?? 2,
          status: variant.status ?? 'ACTIVE',
        },
      }),
    );
  }

  for (let index = 0; index < (spec.images ?? 1); index += 1) {
    await prisma.productImage.create({
      data: {
        productId: product.id,
        objectKey: `catalog/test/${suffix}/${String(index + 1)}.jpg`,
        altText: name,
        sortOrder: index,
        widthPx: 1080,
        heightPx: 1440,
        byteSize: 1000,
        contentType: 'image/jpeg',
        ...(spec.provenance ? { sourceUrl: 'images/1.jpg', attribution: 'Test dataset' } : {}),
      },
    });
  }

  return { product, variants };
}

/** Every key anywhere in a JSON value, for asserting that private fields never appear. */
export function allKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, keys);
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      keys.add(key);
      allKeys(item, keys);
    }
  }
  return keys;
}

/** Fields that must never reach a public catalog or cart response (ADR 0011 decision 7). */
export const PRIVATE_FIELDS = [
  'stockQuantity',
  'lowStockThreshold',
  'priceSource',
  'sourceProvider',
  'sourceExternalId',
  'sourceUrl',
  'sourceContentHash',
  'attribution',
  'objectKey',
  'status',
  'publishedAt',
  'guestTokenHash',
  'userId',
] as const;
