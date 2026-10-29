import type { Prisma, PrismaClient } from '@prisma/client';

import { contentHash, optionKey, variantSku } from './normalize.js';
import { DEMO_LOW_STOCK_THRESHOLD, syntheticPriceMinor, syntheticStock } from './pricing.js';
import { CATALOG_CATEGORIES } from './taxonomy.js';
import type { NormalizedProduct } from './types.js';

/**
 * Writes one normalised product per short transaction (CLAUDE.md: keep transactions short; no
 * network call inside one — images are already in storage before this runs).
 *
 * THE RERUN RULE (extends prisma/seed.ts, ADR 0011):
 *  - Written on create only, never by a rerun: price, price source, stock, low-stock threshold,
 *    variant status, product status/publishedAt, category, featured rank.
 *  - Refreshed on rerun: name, description, brand, gender, source URL — unless an admin edited
 *    them, detected by `sourceContentHash` no longer matching the row (`skipped_local_override`).
 *  - Added on rerun when missing: variants the source lists that the product does not have yet
 *    (e.g. first run without demo pricing), and the image if the product has none.
 *  - Never: deleting or archiving anything.
 *
 * Dry run executes exactly the same writes and then rolls the transaction back, so it reports
 * what would happen AND exercises every database constraint, while leaving no trace.
 */
export interface PersistOptions {
  readonly dryRun: boolean;
  readonly publish: boolean;
  /** `null`: no price can be set, so no variant can be created (priceMinor is required). */
  readonly demoPricing: { readonly currency: string } | null;
  readonly demoStock: boolean;
  readonly skuPrefix: string;
}

export type ProductOutcome = 'inserted' | 'updated' | 'unchanged' | 'skipped_local_override';

export interface PersistResult {
  readonly outcome: ProductOutcome;
  readonly categoriesCreated: readonly string[];
  readonly variantsCreated: number;
  readonly imagesCreated: number;
  readonly movementsCreated: number;
  readonly published: boolean;
}

type Tx = Prisma.TransactionClient;

class DryRunRollback extends Error {
  constructor() {
    super('dry run rollback');
    this.name = 'DryRunRollback';
  }
}

/**
 * Create-if-missing, parents first. An existing category is never modified: its name, order and
 * active flag are merchandising decisions an admin owns.
 */
async function ensureCategory(tx: Tx, slug: string, created: string[]): Promise<string> {
  const existing = await tx.category.findUnique({ where: { slug }, select: { id: true } });
  if (existing) return existing.id;

  const definition = CATALOG_CATEGORIES.find((category) => category.slug === slug);
  if (!definition) throw new Error(`Category "${slug}" is not defined in the catalog taxonomy`);

  const parentId = definition.parentSlug
    ? await ensureCategory(tx, definition.parentSlug, created)
    : null;
  const category = await tx.category.create({
    data: {
      slug: definition.slug,
      name: definition.name,
      description: definition.description,
      sortOrder: definition.sortOrder,
      ...(parentId ? { parentId } : {}),
    },
    select: { id: true },
  });
  created.push(slug);
  return category.id;
}

async function write(
  tx: Tx,
  product: NormalizedProduct,
  options: PersistOptions,
): Promise<PersistResult> {
  const categoriesCreated: string[] = [];
  const categoryId = await ensureCategory(tx, product.categorySlug, categoriesCreated);

  const descriptive = {
    name: product.name,
    description: product.description,
    brand: product.brand,
    gender: product.gender,
  };
  const incomingHash = contentHash(descriptive);

  const existing = await tx.product.findUnique({
    where: {
      sourceProvider_sourceExternalId: {
        sourceProvider: product.provider,
        sourceExternalId: product.externalId,
      },
    },
    select: {
      id: true,
      name: true,
      description: true,
      brand: true,
      gender: true,
      sourceContentHash: true,
      variants: { select: { sku: true, optionKey: true } },
      _count: { select: { images: true } },
    },
  });

  let productId: string;
  let outcome: ProductOutcome;
  let hasImage: boolean;
  const existingSkus = new Set<string>();
  const existingOptionKeys = new Set<string>();

  if (!existing) {
    const createdProduct = await tx.product.create({
      data: {
        ...descriptive,
        slug: product.slug,
        categoryId,
        status: 'DRAFT',
        featuredRank: product.featuredRank ?? null,
        sourceProvider: product.provider,
        sourceExternalId: product.externalId,
        sourceUrl: product.sourceUrl,
        sourceContentHash: incomingHash,
      },
      select: { id: true },
    });
    productId = createdProduct.id;
    outcome = 'inserted';
    hasImage = false;
  } else {
    productId = existing.id;
    hasImage = existing._count.images > 0;
    existing.variants.forEach((variant) => {
      existingSkus.add(variant.sku);
      existingOptionKeys.add(variant.optionKey);
    });

    const currentHash = contentHash({
      name: existing.name,
      description: existing.description,
      brand: existing.brand,
      gender: existing.gender,
    });

    if (existing.sourceContentHash !== currentHash) {
      outcome = 'skipped_local_override';
    } else if (currentHash === incomingHash) {
      outcome = 'unchanged';
    } else {
      await tx.product.update({
        where: { id: productId },
        data: { ...descriptive, sourceUrl: product.sourceUrl, sourceContentHash: incomingHash },
      });
      outcome = 'updated';
    }
  }

  let variantsCreated = 0;
  let movementsCreated = 0;

  if (options.demoPricing) {
    // One price per product: sizes of the same garment do not differ in price at the source.
    const priceMinor = syntheticPriceMinor(
      options.demoPricing.currency,
      product.categorySlug,
      `${product.provider}:${product.externalId}`,
    );
    const sizes: (string | null)[] = product.sizes.length > 0 ? [...product.sizes] : [null];

    for (const size of sizes) {
      const sku = variantSku(options.skuPrefix, product.externalId, size);
      const key = optionKey(product.colour, size);
      if (existingSkus.has(sku) || existingOptionKeys.has(key)) continue;
      existingSkus.add(sku);
      existingOptionKeys.add(key);

      const stockQuantity = options.demoStock ? syntheticStock(sku) : 0;
      const variant = await tx.productVariant.create({
        data: {
          productId,
          sku,
          optionKey: key,
          options: size === null ? { color: product.colour } : { color: product.colour, size },
          priceMinor,
          priceSource: 'SYNTHETIC',
          stockQuantity,
          lowStockThreshold: DEMO_LOW_STOCK_THRESHOLD,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      variantsCreated += 1;

      // Every balance change has a ledger row in the same transaction (database-design.md §4).
      if (stockQuantity > 0) {
        await tx.inventoryMovement.create({
          data: {
            variantId: variant.id,
            delta: stockQuantity,
            resultingQuantity: stockQuantity,
            reason: 'IMPORT_CORRECTION',
            note: 'Synthetic demo stock set by the catalog importer',
          },
        });
        movementsCreated += 1;
      }
    }
  }

  let imagesCreated = 0;
  if (!hasImage && product.image) {
    await tx.productImage.create({
      data: {
        productId,
        objectKey: product.image.objectKey,
        altText: product.image.altText,
        sortOrder: 0,
        widthPx: product.image.widthPx,
        heightPx: product.image.heightPx,
        byteSize: product.image.byteSize,
        contentType: product.image.contentType,
        sourceUrl: product.image.sourceUrl,
        attribution: product.image.attribution,
      },
    });
    imagesCreated = 1;
  }

  // Publication rule (plan §5.4): active category, an image, and an ACTIVE (therefore priced)
  // variant. Only a product that was never published is promoted — `publishedAt` stays set when
  // an admin unpublishes, so a rerun cannot undo that decision.
  let published = false;
  if (options.publish) {
    const state = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: {
        status: true,
        publishedAt: true,
        category: { select: { isActive: true } },
        _count: { select: { images: true, variants: { where: { status: 'ACTIVE' } } } },
      },
    });

    if (
      state.status === 'DRAFT' &&
      state.publishedAt === null &&
      state.category.isActive &&
      state._count.images > 0 &&
      state._count.variants > 0
    ) {
      await tx.product.update({
        where: { id: productId },
        data: { status: 'PUBLISHED', publishedAt: new Date() },
      });
      published = true;
    }
  }

  return {
    outcome,
    categoriesCreated,
    variantsCreated,
    imagesCreated,
    movementsCreated,
    published,
  };
}

export async function persistProduct(
  db: PrismaClient,
  product: NormalizedProduct,
  options: PersistOptions,
): Promise<PersistResult> {
  let result: PersistResult | undefined;

  try {
    await db.$transaction(
      async (tx) => {
        result = await write(tx, product, options);
        if (options.dryRun) throw new DryRunRollback();
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }

  if (!result) throw new Error('persistProduct finished without a result');
  return result;
}
