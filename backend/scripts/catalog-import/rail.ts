import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { toError } from '../../src/lib/async.js';
import type { ObjectStorage } from '../../src/lib/storage.js';
import { storeImage } from './arrivals.js';
import type { ImageInfo } from './image-info.js';
import { productSlug } from './normalize.js';
import { persistProduct } from './persist.js';
import { BDT_BANDS } from './pricing.js';
import { CATALOG_CATEGORIES } from './taxonomy.js';
import type { NormalizedProduct, ProductImageInput } from './types.js';

/**
 * Source adapter + run loop for the home page's clothes-rail pieces (ADR 0027): a SYNTHETIC set
 * of products, one per garment on the rail, so each garment opens a real product page. Same
 * rules as the Dark Edit and Recent Arrivals (ADR 0013, ADR 0017): the products are invented,
 * prices and stock are synthetic, and everything goes through `persistProduct`.
 *
 * Each product gets two gallery photos — front (the main photo) then side — read from
 * `curated/rail/photos/<look>-{front,side}.webp`. Those are rendered from the store owner's own
 * studio photos by `frontend/scripts/recent-arrivals/make_cutouts.py` and committed, so this
 * importer needs no network and no image tooling. Nothing is featured; products are imported
 * last manifest entry first, so the first entry is published last and is the newest.
 */
export const RAIL_PROVIDER = 'commercecore-rail';
export const RAIL_SKU_PREFIX = 'EVR';
export const RAIL_FILE = fileURLToPath(new URL('./curated/rail.json', import.meta.url));
export const RAIL_PHOTO_DIR = fileURLToPath(new URL('./curated/rail/photos/', import.meta.url));
export const RAIL_VIEWS = ['front', 'side'] as const;
export type RailView = (typeof RAIL_VIEWS)[number];

const GENDERS = ['MEN', 'WOMEN', 'UNISEX'] as const;

const productSchema = z.strictObject({
  id: z.string().regex(/^RL\d{3}$/),
  /** Names the two photo files; a plain kebab-case token, so it cannot leave the photo dir. */
  look: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().trim().min(3).max(120),
  category: z.string(),
  gender: z.enum(GENDERS),
  colour: z.string().trim().min(1).max(40),
  /** A key of `sizeSets`. */
  sizes: z.string(),
  description: z.string().trim().min(20).max(1000),
  alt: z.strictObject({
    front: z.string().trim().min(10).max(200),
    side: z.string().trim().min(10).max(200),
  }),
});

const manifestSchema = z
  .object({
    brand: z.string().trim().min(1).max(80),
    sizeSets: z.record(z.string(), z.array(z.string().trim().min(1).max(20)).min(1)),
    products: z.array(productSchema).min(1).max(16),
  })
  .superRefine((manifest, ctx) => {
    const leafCategories = new Set(
      CATALOG_CATEGORIES.filter((category) => category.parentSlug).map((c) => c.slug),
    );
    const seen = { id: new Set<string>(), look: new Set<string>() };

    manifest.products.forEach((product, index) => {
      const issue = (message: string) => {
        ctx.addIssue({ code: 'custom', path: ['products', index], message });
      };
      if (seen.id.has(product.id)) issue(`duplicate id ${product.id}`);
      if (seen.look.has(product.look)) issue(`look ${product.look} is used twice`);
      seen.id.add(product.id);
      seen.look.add(product.look);

      if (!leafCategories.has(product.category)) issue(`unknown category "${product.category}"`);
      if (!(product.category in BDT_BANDS)) issue(`no demo price band for "${product.category}"`);
      if (!(product.sizes in manifest.sizeSets)) issue(`unknown size set "${product.sizes}"`);
    });
  });

export type RailManifest = z.output<typeof manifestSchema>;
export type RailItem = RailManifest['products'][number];

export function parseRail(json: unknown): RailManifest {
  return manifestSchema.parse(json);
}

export async function loadRail(file: string = RAIL_FILE): Promise<RailManifest> {
  return parseRail(JSON.parse(await readFile(file, 'utf8')));
}

export function railPhotoFile(look: string, view: RailView): string {
  return `${look}-${view}.webp`;
}

export const RAIL_PHOTO_CREDIT =
  'Studio photo supplied by the store owner, background replaced. Synthetic demo product.';

export function normalizeRailItem(item: RailItem, manifest: RailManifest): NormalizedProduct {
  return {
    provider: RAIL_PROVIDER,
    externalId: item.id,
    name: item.name,
    slug: productSlug(item.name, item.id.toLowerCase()),
    description: item.description,
    brand: manifest.brand,
    gender: item.gender,
    categorySlug: item.category,
    colour: item.colour,
    sizes: manifest.sizeSets[item.sizes] ?? [],
    sourceUrl: null,
    image: null,
    gallery: [],
    cutout: null,
  };
}

/** Reads a committed rail photo. */
export interface RailPhotoSource {
  get(look: string, view: RailView): Promise<Buffer>;
}

export function createRailPhotoSource(dir: string = RAIL_PHOTO_DIR): RailPhotoSource {
  // `look` passed the manifest's kebab-case pattern, so it cannot climb out of `dir`.
  return { get: (look, view) => readFile(path.join(dir, railPhotoFile(look, view))) };
}

export interface RailOptions {
  readonly dryRun: boolean;
  readonly publish: boolean;
  readonly currency: string;
}

export interface RailReport {
  provider: string;
  startedAt: string;
  finishedAt: string;
  options: RailOptions;
  products: {
    total: number;
    inserted: number;
    updated: number;
    unchanged: number;
    skippedLocalOverride: number;
    failed: number;
    published: number;
  };
  photos: { stored: number; alreadyInStorage: number };
  categoriesCreated: string[];
  variantsCreated: number;
  imagesCreated: number;
  inventoryMovementsCreated: number;
  failures: { externalId: string; stage: string; message: string }[];
}

export interface RailDependencies {
  readonly db: PrismaClient;
  readonly storage: ObjectStorage;
  readonly photos: RailPhotoSource;
  readonly manifest: RailManifest;
}

/**
 * Sequential, oldest first (the manifest reversed), so publication order is rail order. Photos
 * are validated and stored before each product's one short transaction. A product whose front
 * photo fails still imports, but with no photos: no photo keeps it a draft (publication rule),
 * and a rerun adds them once they are fixed.
 */
export async function runRailImport(
  deps: RailDependencies,
  options: RailOptions,
): Promise<RailReport> {
  const { db, storage, photos, manifest } = deps;
  const startedAt = new Date().toISOString();
  const report: RailReport = {
    provider: RAIL_PROVIDER,
    startedAt,
    finishedAt: startedAt,
    options,
    products: {
      total: manifest.products.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skippedLocalOverride: 0,
      failed: 0,
      published: 0,
    },
    photos: { stored: 0, alreadyInStorage: 0 },
    categoriesCreated: [],
    variantsCreated: 0,
    imagesCreated: 0,
    inventoryMovementsCreated: 0,
    failures: [],
  };
  const categoriesCreated = new Set<string>();
  const note = (externalId: string, stage: string, error: unknown) => {
    report.failures.push({ externalId, stage, message: toError(error).message });
  };

  for (const item of [...manifest.products].reverse()) {
    const base = `catalog/${RAIL_PROVIDER}/${item.id.toLowerCase()}`;
    let product = normalizeRailItem(item, manifest);

    try {
      const stored: ProductImageInput[] = [];
      for (const [index, view] of RAIL_VIEWS.entries()) {
        const result = await storeImage(
          storage,
          await photos.get(item.look, view),
          `${base}/${index + 1}`,
          options.dryRun,
        );
        if (result.stored) report.photos.stored += 1;
        else if (!options.dryRun) report.photos.alreadyInStorage += 1;
        stored.push(imageInput(result, item, view));
      }
      const [main, ...gallery] = stored;
      product = { ...product, image: main ?? null, gallery };
    } catch (error) {
      note(item.id, 'photo', error);
    }

    try {
      const result = await persistProduct(db, product, {
        dryRun: options.dryRun,
        publish: options.publish,
        demoPricing: { currency: options.currency },
        demoStock: true,
        skuPrefix: RAIL_SKU_PREFIX,
      });
      result.categoriesCreated.forEach((slug) => categoriesCreated.add(slug));
      if (result.outcome === 'skipped_local_override') report.products.skippedLocalOverride += 1;
      else report.products[result.outcome] += 1;
      if (result.published) report.products.published += 1;
      report.variantsCreated += result.variantsCreated;
      report.imagesCreated += result.imagesCreated;
      report.inventoryMovementsCreated += result.movementsCreated;
    } catch (error) {
      report.products.failed += 1;
      note(item.id, 'persist', error);
    }
  }

  report.categoriesCreated = [...categoriesCreated];
  report.finishedAt = new Date().toISOString();
  return report;
}

function imageInput(
  stored: { objectKey: string; info: ImageInfo },
  item: RailItem,
  view: RailView,
): ProductImageInput {
  return {
    objectKey: stored.objectKey,
    altText: item.alt[view],
    ...stored.info,
    // Provenance only (ADR 0011): where the committed file lives in this repository.
    sourceUrl: `repo:backend/scripts/catalog-import/curated/rail/photos/${railPhotoFile(item.look, view)}`,
    attribution: RAIL_PHOTO_CREDIT,
  };
}
