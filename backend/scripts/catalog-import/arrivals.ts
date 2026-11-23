import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { sleep, toError } from '../../src/lib/async.js';
import type { ObjectStorage } from '../../src/lib/storage.js';
import { type PhotoSource, photoCredit, photoSchema } from './dark-edit.js';
import { extensionFor, type ImageInfo, inspectImage } from './image-info.js';
import { productSlug } from './normalize.js';
import { persistProduct } from './persist.js';
import { BDT_BANDS } from './pricing.js';
import { CATALOG_CATEGORIES } from './taxonomy.js';
import type { NormalizedProduct, ProductImageInput } from './types.js';

/**
 * Source adapter + run loop for "Recent Arrivals": a small, SYNTHETIC set of new products that
 * the home page hangs on a clothes rail (ADR 0017). Same rules as the Dark Edit (ADR 0013): the
 * products are invented, the photos are credited Unsplash photos, and everything goes through
 * `persistProduct`. Two differences:
 *
 *  - each product also gets a CUTOUT image — its photo with the background removed — read from
 *    `curated/arrivals/cutouts/<photoId>.webp`, files made by `cutouts/make_cutouts.py` and
 *    committed, so this importer needs no image tooling;
 *  - nothing is featured. "Arrival" order is publication order: products are imported last
 *    manifest entry first, so the first entry is published last and is the newest.
 */
export const ARRIVALS_PROVIDER = 'commercecore-arrivals';
export const ARRIVALS_SKU_PREFIX = 'EV';
export const ARRIVALS_COLLECTION = 'arrivals';
export const ARRIVALS_FILE = fileURLToPath(new URL('./curated/arrivals.json', import.meta.url));
export const CUTOUT_DIR = fileURLToPath(new URL('./curated/arrivals/cutouts/', import.meta.url));

const GENDERS = ['MEN', 'WOMEN', 'UNISEX'] as const;

const productSchema = z.strictObject({
  id: z.string().regex(/^AR\d{3}$/),
  name: z.string().trim().min(3).max(120),
  category: z.string(),
  gender: z.enum(GENDERS),
  colour: z.string().trim().min(1).max(40),
  /** A key of `sizeSets`. */
  sizes: z.string(),
  description: z.string().trim().min(20).max(1000),
  photo: photoSchema,
});

const manifestSchema = z
  .object({
    brand: z.string().trim().min(1).max(80),
    sizeSets: z.record(z.string(), z.array(z.string().trim().min(1).max(20)).min(1)),
    products: z.array(productSchema).min(4).max(16),
  })
  .superRefine((manifest, ctx) => {
    const leafCategories = new Set(
      CATALOG_CATEGORIES.filter((category) => category.parentSlug).map((c) => c.slug),
    );
    const seen = { id: new Set<string>(), photo: new Set<string>() };

    manifest.products.forEach((product, index) => {
      const issue = (message: string) => {
        ctx.addIssue({ code: 'custom', path: ['products', index], message });
      };
      if (seen.id.has(product.id)) issue(`duplicate id ${product.id}`);
      if (seen.photo.has(product.photo.id)) issue(`photo ${product.photo.id} is used twice`);
      seen.id.add(product.id);
      seen.photo.add(product.photo.id);

      if (!leafCategories.has(product.category)) issue(`unknown category "${product.category}"`);
      if (!(product.category in BDT_BANDS)) issue(`no demo price band for "${product.category}"`);
      if (!(product.sizes in manifest.sizeSets)) issue(`unknown size set "${product.sizes}"`);
    });
  });

export type ArrivalsManifest = z.output<typeof manifestSchema>;
export type ArrivalItem = ArrivalsManifest['products'][number];

export function parseArrivals(json: unknown): ArrivalsManifest {
  return manifestSchema.parse(json);
}

export async function loadArrivals(file: string = ARRIVALS_FILE): Promise<ArrivalsManifest> {
  return parseArrivals(JSON.parse(await readFile(file, 'utf8')));
}

export function cutoutCredit(photo: ArrivalItem['photo']): string {
  return `Cut-out (background removed) of a photo by ${photo.photographer} (https://unsplash.com/@${photo.profile}) on Unsplash — Unsplash License. Synthetic demo product.`;
}

export function normalizeArrival(item: ArrivalItem, manifest: ArrivalsManifest): NormalizedProduct {
  return {
    provider: ARRIVALS_PROVIDER,
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
    cutout: null,
  };
}

/** Reads a committed cut-out. It must be a transparent-capable format: PNG or WebP. */
export interface CutoutSource {
  get(photoId: string): Promise<Buffer>;
}

export function createCutoutSource(dir: string = CUTOUT_DIR): CutoutSource {
  return {
    // `photoId` passed the manifest's CDN-id pattern, so it cannot climb out of `dir`.
    get: (photoId) => readFile(path.join(dir, `${photoId}.webp`)),
  };
}

function assertTransparentCapable(info: ImageInfo): void {
  if (info.contentType === 'image/jpeg') throw new Error('cut-out must be PNG or WebP, not JPEG');
}

export interface ArrivalsOptions {
  readonly dryRun: boolean;
  readonly publish: boolean;
  readonly currency: string;
}

export interface ArrivalsReport {
  provider: string;
  startedAt: string;
  finishedAt: string;
  options: ArrivalsOptions;
  products: {
    total: number;
    inserted: number;
    updated: number;
    unchanged: number;
    skippedLocalOverride: number;
    failed: number;
    published: number;
  };
  photos: { downloaded: number; cached: number; stored: number; alreadyInStorage: number };
  cutouts: { stored: number; alreadyInStorage: number };
  categoriesCreated: string[];
  variantsCreated: number;
  imagesCreated: number;
  inventoryMovementsCreated: number;
  failures: { externalId: string; stage: string; message: string }[];
}

export interface ArrivalsDependencies {
  readonly db: PrismaClient;
  readonly storage: ObjectStorage;
  readonly photos: PhotoSource;
  readonly cutouts: CutoutSource;
  readonly manifest: ArrivalsManifest;
}

/** Validate by content, then store under `objectKey` unless it is already there. */
export async function storeImage(
  storage: ObjectStorage,
  bytes: Buffer,
  keyWithoutExtension: string,
  dryRun: boolean,
): Promise<{ objectKey: string; info: ImageInfo; stored: boolean }> {
  const inspected = inspectImage(bytes);
  if (!inspected.ok) throw new Error(`image rejected: ${inspected.reason}`);
  const objectKey = `${keyWithoutExtension}.${extensionFor(inspected.info.contentType)}`;
  let stored = false;
  if (!dryRun && !(await storage.exists(objectKey))) {
    await storage.put(objectKey, bytes, inspected.info.contentType);
    stored = true;
  }
  return { objectKey, info: inspected.info, stored };
}

/**
 * Sequential, oldest arrival first (the manifest reversed), so publication order is arrival
 * order. Images are fetched, validated and stored before each product's one short transaction.
 * A product whose photo or cut-out fails still imports, but without that image: no photo keeps it
 * a draft (publication rule); no cut-out keeps it off the rail.
 */
export async function runArrivalsImport(
  deps: ArrivalsDependencies,
  options: ArrivalsOptions,
): Promise<ArrivalsReport> {
  const { db, storage, photos, cutouts, manifest } = deps;
  const startedAt = new Date().toISOString();
  const report: ArrivalsReport = {
    provider: ARRIVALS_PROVIDER,
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
    photos: { downloaded: 0, cached: 0, stored: 0, alreadyInStorage: 0 },
    cutouts: { stored: 0, alreadyInStorage: 0 },
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
    const base = `catalog/${ARRIVALS_PROVIDER}/${item.id.toLowerCase()}`;
    const sourceUrl = `https://unsplash.com/photos/${item.photo.page}`;
    let product = normalizeArrival(item, manifest);

    try {
      const fetched = await photos.get(item.photo.id);
      if (fetched.cached) {
        report.photos.cached += 1;
      } else {
        report.photos.downloaded += 1;
        await sleep(250);
      }
      const photo = await storeImage(storage, fetched.bytes, `${base}/1`, options.dryRun);
      if (photo.stored) report.photos.stored += 1;
      else if (!options.dryRun) report.photos.alreadyInStorage += 1;
      product = { ...product, image: imageInput(photo, item, sourceUrl, photoCredit(item.photo)) };
    } catch (error) {
      note(item.id, 'photo', error);
    }

    try {
      const cut = await storeImage(
        storage,
        await cutouts.get(item.photo.id),
        `${base}/cutout`,
        options.dryRun,
      );
      assertTransparentCapable(cut.info);
      if (cut.stored) report.cutouts.stored += 1;
      else if (!options.dryRun) report.cutouts.alreadyInStorage += 1;
      product = { ...product, cutout: imageInput(cut, item, sourceUrl, cutoutCredit(item.photo)) };
    } catch (error) {
      note(item.id, 'cutout', error);
    }

    try {
      const result = await persistProduct(db, product, {
        dryRun: options.dryRun,
        publish: options.publish,
        demoPricing: { currency: options.currency },
        demoStock: true,
        skuPrefix: ARRIVALS_SKU_PREFIX,
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
  item: ArrivalItem,
  sourceUrl: string,
  attribution: string,
): ProductImageInput {
  return {
    objectKey: stored.objectKey,
    altText: item.photo.alt,
    ...stored.info,
    sourceUrl,
    attribution,
  };
}
