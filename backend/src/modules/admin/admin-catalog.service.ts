import { type Prisma, type ProductGender, type ProductStatus } from '@prisma/client';

import { env } from '../../config/env.js';
import { conflict, notFound, validationFailed } from '../../http/errors.js';
import { type Pagination, toSkipTake } from '../../http/schemas.js';
import { toImageView } from '../../lib/media.js';
import { prisma } from '../../lib/prisma.js';
import { assertObjectKey } from '../../lib/storage.js';
import { withTransaction } from '../../lib/transaction.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';
import type { AdminActionContext } from './customers.service.js';
import type {
  AdminImageCreateBody,
  AdminImageUpdateBody,
  AdminProductCreateBody,
  AdminProductUpdateBody,
  AdminVariantCreateBody,
  AdminVariantUpdateBody,
} from './admin-catalog.schemas.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function optionKey(options: Record<string, string>): string {
  return Object.entries(options)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${value.toLowerCase()}`)
    .join('|');
}

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

// ---------------------------------------------------------------------------
// Admin product views
// ---------------------------------------------------------------------------

export interface AdminProductListItem {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly brand: string | null;
  readonly status: ProductStatus;
  readonly gender: ProductGender | null;
  readonly category: { readonly id: string; readonly slug: string; readonly name: string };
  readonly variantCount: number;
  readonly imageCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
}

const ADMIN_LIST_SELECT = {
  id: true,
  name: true,
  slug: true,
  brand: true,
  status: true,
  gender: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, slug: true, name: true } },
  _count: { select: { variants: true, images: true } },
} satisfies Prisma.ProductSelect;

type AdminListRow = Prisma.ProductGetPayload<{ select: typeof ADMIN_LIST_SELECT }>;

function toAdminListItem(row: AdminListRow): AdminProductListItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    brand: row.brand,
    status: row.status,
    gender: row.gender,
    category: row.category,
    variantCount: row._count.variants,
    imageCount: row._count.images,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

export interface AdminProductFilters {
  readonly q?: string;
  readonly status?: ProductStatus;
  readonly categoryId?: string;
  readonly gender?: ProductGender;
}

export async function adminListProducts(
  pagination: Pagination,
  filters: AdminProductFilters,
): Promise<{ items: AdminProductListItem[]; total: number }> {
  const { skip, take } = toSkipTake(pagination);

  const where: Prisma.ProductWhereInput = {
    ...(filters.q
      ? {
          OR: [
            { name: { contains: filters.q, mode: 'insensitive' } },
            { brand: { contains: filters.q, mode: 'insensitive' } },
            { variants: { some: { sku: { contains: filters.q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.gender ? { gender: filters.gender } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      skip,
      take,
      select: ADMIN_LIST_SELECT,
    }),
    prisma.product.count({ where }),
  ]);

  return { items: rows.map(toAdminListItem), total };
}

// ---------------------------------------------------------------------------
// Admin product detail
// ---------------------------------------------------------------------------

const ADMIN_DETAIL_SELECT = {
  id: true,
  name: true,
  slug: true,
  description: true,
  brand: true,
  status: true,
  gender: true,
  featuredRank: true,
  publishedAt: true,
  sourceProvider: true,
  sourceExternalId: true,
  sourceUrl: true,
  sourceContentHash: true,
  createdAt: true,
  updatedAt: true,
  category: {
    select: {
      id: true,
      slug: true,
      name: true,
      parent: { select: { id: true, slug: true, name: true } },
    },
  },
  variants: {
    orderBy: { createdAt: 'asc' as const },
    select: {
      id: true,
      sku: true,
      optionKey: true,
      options: true,
      priceMinor: true,
      priceSource: true,
      compareAtPriceMinor: true,
      stockQuantity: true,
      lowStockThreshold: true,
      weightGrams: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  images: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    select: {
      id: true,
      objectKey: true,
      altText: true,
      sortOrder: true,
      kind: true,
      variantId: true,
      widthPx: true,
      heightPx: true,
      byteSize: true,
      contentType: true,
      sourceUrl: true,
      attribution: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ProductSelect;

export async function adminGetProduct(productId: string) {
  const row = await prisma.product.findUnique({
    where: { id: productId },
    select: ADMIN_DETAIL_SELECT,
  });

  if (!row) {
    throw notFound('That product does not exist.');
  }

  return {
    ...row,
    currency: env.STORE_CURRENCY,
    images: row.images.map((img) => ({
      ...img,
      url: toImageView(img).url,
    })),
  };
}

// ---------------------------------------------------------------------------
// Create product
// ---------------------------------------------------------------------------

export async function adminCreateProduct(
  body: AdminProductCreateBody,
  context: AdminActionContext,
) {
  const slug = body.slug ?? generateSlug(body.name);

  const category = await prisma.category.findUnique({
    where: { id: body.categoryId },
    select: { id: true },
  });
  if (!category) {
    throw validationFailed([{ field: 'categoryId', issue: 'Category does not exist.' }]);
  }

  const publishedAt = body.status === 'PUBLISHED' ? new Date() : undefined;

  return withTransaction(
    async (tx) => {
      const product = await tx.product.create({
        data: {
          name: body.name,
          slug,
          description: body.description ?? null,
          brand: body.brand ?? null,
          categoryId: body.categoryId,
          gender: body.gender ?? null,
          status: body.status,
          featuredRank: body.featuredRank ?? null,
          ...(publishedAt ? { publishedAt } : {}),
        },
        select: ADMIN_DETAIL_SELECT,
      });

      await recordAudit(tx, {
        action: AuditAction.PRODUCT_CREATED,
        entityType: 'Product',
        entityId: product.id,
        actor: context.actor,
        after: { name: product.name, slug: product.slug, status: product.status },
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });

      return {
        ...product,
        currency: env.STORE_CURRENCY,
        images: product.images.map((img) => ({ ...img, url: toImageView(img).url })),
      };
    },
    { label: 'admin.createProduct' },
  );
}

// ---------------------------------------------------------------------------
// Update product
// ---------------------------------------------------------------------------

export async function adminUpdateProduct(
  productId: string,
  body: AdminProductUpdateBody,
  context: AdminActionContext,
) {
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, slug: true, status: true, publishedAt: true },
  });

  if (!existing) {
    throw notFound('That product does not exist.');
  }

  if (body.categoryId) {
    const category = await prisma.category.findUnique({
      where: { id: body.categoryId },
      select: { id: true },
    });
    if (!category) {
      throw validationFailed([{ field: 'categoryId', issue: 'Category does not exist.' }]);
    }
  }

  const data: Prisma.ProductUpdateInput = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.slug !== undefined) data.slug = body.slug;
  if (body.description !== undefined) data.description = body.description;
  if (body.brand !== undefined) data.brand = body.brand;
  if (body.categoryId !== undefined) data.category = { connect: { id: body.categoryId } };
  if (body.gender !== undefined) data.gender = body.gender;
  if (body.featuredRank !== undefined) data.featuredRank = body.featuredRank;

  if (body.status !== undefined) {
    data.status = body.status;
    if (body.status === 'PUBLISHED' && !existing.publishedAt) {
      data.publishedAt = new Date();
    }
  }

  return withTransaction(
    async (tx) => {
      const product = await tx.product.update({
        where: { id: productId },
        data,
        select: ADMIN_DETAIL_SELECT,
      });

      const before: Record<string, string | number | boolean | null> = {};
      const after: Record<string, string | number | boolean | null> = {};
      if (body.name !== undefined) {
        before.name = existing.name;
        after.name = body.name;
      }
      if (body.slug !== undefined) {
        before.slug = existing.slug;
        after.slug = body.slug;
      }
      if (body.status !== undefined) {
        before.status = existing.status;
        after.status = body.status;
      }

      await recordAudit(tx, {
        action: AuditAction.PRODUCT_UPDATED,
        entityType: 'Product',
        entityId: productId,
        actor: context.actor,
        before,
        after,
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });

      return {
        ...product,
        currency: env.STORE_CURRENCY,
        images: product.images.map((img) => ({ ...img, url: toImageView(img).url })),
      };
    },
    { label: 'admin.updateProduct' },
  );
}

// ---------------------------------------------------------------------------
// Archive product
// ---------------------------------------------------------------------------

export async function adminArchiveProduct(productId: string, context: AdminActionContext) {
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, status: true },
  });

  if (!existing) {
    throw notFound('That product does not exist.');
  }

  if (existing.status === 'ARCHIVED') {
    return adminGetProduct(productId);
  }

  await withTransaction(
    async (tx) => {
      await tx.product.update({
        where: { id: productId },
        data: { status: 'ARCHIVED' },
      });

      await recordAudit(tx, {
        action: AuditAction.PRODUCT_ARCHIVED,
        entityType: 'Product',
        entityId: productId,
        actor: context.actor,
        before: { status: existing.status },
        after: { status: 'ARCHIVED' },
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });
    },
    { label: 'admin.archiveProduct' },
  );

  return adminGetProduct(productId);
}

// ---------------------------------------------------------------------------
// Variant CRUD
// ---------------------------------------------------------------------------

export async function adminCreateVariant(
  productId: string,
  body: AdminVariantCreateBody,
  context: AdminActionContext,
) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    throw notFound('That product does not exist.');
  }

  const key = optionKey(body.options);

  return withTransaction(
    async (tx) => {
      const existing = await tx.productVariant.findUnique({
        where: { productId_optionKey: { productId, optionKey: key } },
        select: { id: true },
      });
      if (existing) {
        throw conflict('A variant with those options already exists on this product.');
      }

      const existingSku = await tx.productVariant.findUnique({
        where: { sku: body.sku },
        select: { id: true },
      });
      if (existingSku) {
        throw conflict('That SKU is already in use.');
      }

      const variant = await tx.productVariant.create({
        data: {
          productId,
          sku: body.sku,
          optionKey: key,
          options: body.options,
          priceMinor: body.priceMinor,
          compareAtPriceMinor: body.compareAtPriceMinor ?? null,
          stockQuantity: body.stockQuantity,
          lowStockThreshold: body.lowStockThreshold,
          weightGrams: body.weightGrams ?? null,
          status: body.status,
        },
      });

      await recordAudit(tx, {
        action: AuditAction.VARIANT_CREATED,
        entityType: 'ProductVariant',
        entityId: variant.id,
        actor: context.actor,
        after: { sku: variant.sku, productId, priceMinor: variant.priceMinor },
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });

      return variant;
    },
    { label: 'admin.createVariant' },
  );
}

export async function adminUpdateVariant(
  productId: string,
  variantId: string,
  body: AdminVariantUpdateBody,
  context: AdminActionContext,
) {
  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, productId },
    select: { id: true, sku: true, priceMinor: true, status: true },
  });
  if (!variant) {
    throw notFound('That variant does not exist on this product.');
  }

  const data: Prisma.ProductVariantUpdateInput = {};
  if (body.sku !== undefined) data.sku = body.sku;
  if (body.options !== undefined) {
    data.options = body.options;
    data.optionKey = optionKey(body.options);
  }
  if (body.priceMinor !== undefined) data.priceMinor = body.priceMinor;
  if (body.compareAtPriceMinor !== undefined) data.compareAtPriceMinor = body.compareAtPriceMinor;
  if (body.stockQuantity !== undefined) data.stockQuantity = body.stockQuantity;
  if (body.lowStockThreshold !== undefined) data.lowStockThreshold = body.lowStockThreshold;
  if (body.weightGrams !== undefined) data.weightGrams = body.weightGrams;
  if (body.status !== undefined) data.status = body.status;

  return withTransaction(
    async (tx) => {
      const updated = await tx.productVariant.update({
        where: { id: variantId },
        data,
      });

      const before: Record<string, string | number | null> = {};
      const after: Record<string, string | number | null> = {};
      if (body.sku !== undefined) {
        before.sku = variant.sku;
        after.sku = body.sku;
      }
      if (body.priceMinor !== undefined) {
        before.priceMinor = variant.priceMinor;
        after.priceMinor = body.priceMinor;
      }
      if (body.status !== undefined) {
        before.status = variant.status;
        after.status = body.status;
      }

      await recordAudit(tx, {
        action: AuditAction.VARIANT_UPDATED,
        entityType: 'ProductVariant',
        entityId: variantId,
        actor: context.actor,
        before,
        after,
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });

      return updated;
    },
    { label: 'admin.updateVariant' },
  );
}

// ---------------------------------------------------------------------------
// Image CRUD
// ---------------------------------------------------------------------------

/**
 * With STORAGE_DRIVER=disabled there is no bucket, so no file can exist behind a key: the new
 * row would only be a broken image on the storefront. Refused with the reason instead.
 */
export function assertImageStorageEnabled(driver: typeof env.STORAGE_DRIVER): void {
  if (driver === 'disabled') {
    throw conflict(
      'Image storage is not set up on this server yet, so images cannot be added. ' +
        'Configure an S3 bucket (STORAGE_DRIVER=s3) first.',
    );
  }
}

export async function adminCreateImage(
  productId: string,
  body: AdminImageCreateBody,
  context: AdminActionContext,
) {
  assertImageStorageEnabled(env.STORAGE_DRIVER);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true },
  });
  if (!product) {
    throw notFound('That product does not exist.');
  }

  assertObjectKey(body.objectKey);

  if (body.variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: body.variantId, productId },
      select: { id: true },
    });
    if (!variant) {
      throw validationFailed([
        { field: 'variantId', issue: 'Variant does not exist on this product.' },
      ]);
    }
  }

  return withTransaction(
    async (tx) => {
      const image = await tx.productImage.create({
        data: {
          productId,
          objectKey: body.objectKey,
          altText: body.altText,
          sortOrder: body.sortOrder,
          kind: body.kind,
          variantId: body.variantId ?? null,
          widthPx: body.widthPx ?? null,
          heightPx: body.heightPx ?? null,
          byteSize: body.byteSize ?? null,
          contentType: body.contentType ?? null,
        },
      });

      await recordAudit(tx, {
        action: AuditAction.IMAGE_CREATED,
        entityType: 'ProductImage',
        entityId: image.id,
        actor: context.actor,
        after: { productId, objectKey: body.objectKey, kind: body.kind },
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });

      return { ...image, url: toImageView(image).url };
    },
    { label: 'admin.createImage' },
  );
}

export async function adminUpdateImage(
  productId: string,
  imageId: string,
  body: AdminImageUpdateBody,
  context: AdminActionContext,
) {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
    select: { id: true, altText: true, sortOrder: true, kind: true },
  });
  if (!image) {
    throw notFound('That image does not exist on this product.');
  }

  if (body.variantId) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: body.variantId, productId },
      select: { id: true },
    });
    if (!variant) {
      throw validationFailed([
        { field: 'variantId', issue: 'Variant does not exist on this product.' },
      ]);
    }
  }

  const data: Prisma.ProductImageUpdateInput = {};
  if (body.altText !== undefined) data.altText = body.altText;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
  if (body.kind !== undefined) data.kind = body.kind;
  if (body.variantId !== undefined)
    data.variant = body.variantId ? { connect: { id: body.variantId } } : { disconnect: true };

  return withTransaction(
    async (tx) => {
      const updated = await tx.productImage.update({
        where: { id: imageId },
        data,
        select: {
          id: true,
          objectKey: true,
          altText: true,
          sortOrder: true,
          kind: true,
          variantId: true,
          widthPx: true,
          heightPx: true,
          byteSize: true,
          contentType: true,
          sourceUrl: true,
          attribution: true,
          createdAt: true,
        },
      });

      await recordAudit(tx, {
        action: AuditAction.IMAGE_UPDATED,
        entityType: 'ProductImage',
        entityId: imageId,
        actor: context.actor,
        before: { altText: image.altText, sortOrder: image.sortOrder },
        after: { altText: updated.altText, sortOrder: updated.sortOrder },
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });

      return { ...updated, url: toImageView(updated).url };
    },
    { label: 'admin.updateImage' },
  );
}

export async function adminDeleteImage(
  productId: string,
  imageId: string,
  context: AdminActionContext,
) {
  const image = await prisma.productImage.findFirst({
    where: { id: imageId, productId },
    select: { id: true, objectKey: true, kind: true },
  });
  if (!image) {
    throw notFound('That image does not exist on this product.');
  }

  return withTransaction(
    async (tx) => {
      await tx.productImage.delete({ where: { id: imageId } });

      await recordAudit(tx, {
        action: AuditAction.IMAGE_DELETED,
        entityType: 'ProductImage',
        entityId: imageId,
        actor: context.actor,
        before: { objectKey: image.objectKey, kind: image.kind },
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });
    },
    { label: 'admin.deleteImage' },
  );
}
