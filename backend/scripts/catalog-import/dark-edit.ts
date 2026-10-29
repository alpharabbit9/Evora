import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { sleep, toError, withRetry, withTimeout } from '../../src/lib/async.js';
import type { ObjectStorage } from '../../src/lib/storage.js';
import { extensionFor, inspectImage } from './image-info.js';
import { productSlug } from './normalize.js';
import { persistProduct } from './persist.js';
import { BDT_BANDS } from './pricing.js';
import { CATALOG_CATEGORIES } from './taxonomy.js';
import type { NormalizedProduct } from './types.js';

/**
 * Source adapter + run loop for "The Dark Edit": a hand-written, SYNTHETIC 40-piece collection
 * of dark outerwear, blazers, boots and hoodies that the storefront shows before everything
 * else (`Product.featuredRank`, docs/fashion-catalog-setup.md §14, ADR 0013).
 *
 * The dataset is `curated/dark-edit.json`: names, copy, sizes and the house brand are invented
 * for the demo; each photo is an Unsplash photo (Unsplash License) credited by name. Only the
 * photo comes from the network — it is cached on disk, validated by its bytes and put in object
 * storage before the product's transaction opens, exactly like the Kaggle importer.
 */
export const DARK_EDIT_PROVIDER = 'commercecore-dark-edit';
export const DARK_EDIT_SKU_PREFIX = 'EV';
export const DARK_EDIT_FILE = fileURLToPath(new URL('./curated/dark-edit.json', import.meta.url));

/** Photos are fetched only from Unsplash's image CDN, at a fixed size; never an arbitrary URL. */
const PHOTO_HOST = 'https://images.unsplash.com';
const PHOTO_WIDTH = 1600;
export function photoUrl(photoId: string): string {
  return `${PHOTO_HOST}/photo-${photoId}?w=${PHOTO_WIDTH}&q=80&fm=jpg&fit=max`;
}

const GENDERS = ['MEN', 'WOMEN', 'UNISEX'] as const;

const photoSchema = z.strictObject({
  /** The CDN id (`1551028719-00167b16eac5`), not the photo page id. */
  id: z.string().regex(/^\d{10,13}-[0-9a-f]{12}$/, 'not an Unsplash CDN photo id'),
  /** Photo page slug on unsplash.com, for provenance and credit. */
  page: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  photographer: z.string().trim().min(1).max(100),
  profile: z.string().regex(/^[A-Za-z0-9_.-]{1,60}$/),
  alt: z.string().trim().min(10).max(200),
});

const productSchema = z.strictObject({
  id: z.string().regex(/^DE\d{3}$/),
  rank: z.number().int().positive(),
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
    products: z.array(productSchema).min(35).max(40),
  })
  .superRefine((manifest, ctx) => {
    const leafCategories = new Set(
      CATALOG_CATEGORIES.filter((category) => category.parentSlug).map((c) => c.slug),
    );
    const seen = { id: new Set<string>(), rank: new Set<number>(), photo: new Set<string>() };

    manifest.products.forEach((product, index) => {
      const issue = (message: string) => {
        ctx.addIssue({ code: 'custom', path: ['products', index], message });
      };
      if (seen.id.has(product.id)) issue(`duplicate id ${product.id}`);
      if (seen.rank.has(product.rank)) issue(`duplicate rank ${product.rank}`);
      if (seen.photo.has(product.photo.id)) issue(`photo ${product.photo.id} is used twice`);
      seen.id.add(product.id);
      seen.rank.add(product.rank);
      seen.photo.add(product.photo.id);

      if (!leafCategories.has(product.category)) issue(`unknown category "${product.category}"`);
      if (!(product.category in BDT_BANDS)) issue(`no demo price band for "${product.category}"`);
      if (!(product.sizes in manifest.sizeSets)) issue(`unknown size set "${product.sizes}"`);
    });
  });

export type DarkEditManifest = z.output<typeof manifestSchema>;
export type DarkEditItem = DarkEditManifest['products'][number];

export function parseDarkEdit(json: unknown): DarkEditManifest {
  return manifestSchema.parse(json);
}

export async function loadDarkEdit(file: string = DARK_EDIT_FILE): Promise<DarkEditManifest> {
  return parseDarkEdit(JSON.parse(await readFile(file, 'utf8')));
}

export function photoCredit(photo: DarkEditItem['photo']): string {
  return `Photo by ${photo.photographer} (https://unsplash.com/@${photo.profile}) on Unsplash — Unsplash License. Synthetic demo product.`;
}

export function normalizeDarkEditItem(
  item: DarkEditItem,
  manifest: DarkEditManifest,
): NormalizedProduct {
  return {
    provider: DARK_EDIT_PROVIDER,
    externalId: item.id,
    name: item.name,
    slug: productSlug(item.name, item.id.toLowerCase()),
    description: item.description,
    brand: manifest.brand,
    gender: item.gender,
    categorySlug: item.category,
    colour: item.colour,
    sizes: manifest.sizeSets[item.sizes] ?? [],
    // A synthetic product has no retailer listing; the photo's page is on the image row.
    sourceUrl: null,
    image: null,
    featuredRank: item.rank,
  };
}

export interface PhotoSource {
  get(photoId: string): Promise<{ bytes: Buffer; cached: boolean }>;
}

class HttpStatusError extends Error {
  constructor(readonly status: number) {
    super(`Unsplash CDN answered HTTP ${status}`);
    this.name = 'HttpStatusError';
  }
}

/** Cache first, CDN second. Cached under `<dataDir>/dark-edit/images/<photoId>.jpg`. */
export function createPhotoSource(dataDir: string, fetchImpl: typeof fetch = fetch): PhotoSource {
  const root = path.resolve(dataDir, 'dark-edit', 'images');

  return {
    async get(photoId) {
      const file = path.join(root, `${photoId}.jpg`);
      try {
        if ((await stat(file)).isFile()) return { bytes: await readFile(file), cached: true };
      } catch {
        // Not cached yet.
      }

      const bytes = await withRetry(
        () =>
          withTimeout(`unsplash photo ${photoId}`, 30_000, async (signal) => {
            const response = await fetchImpl(photoUrl(photoId), { signal });
            if (!response.ok) throw new HttpStatusError(response.status);
            return Buffer.from(await response.arrayBuffer());
          }),
        {
          attempts: 4,
          baseDelayMs: 500,
          label: 'unsplash photo',
          // 404 means the id is wrong; asking again will not fix it.
          isRetryable: (error) =>
            !(error instanceof HttpStatusError) || error.status === 429 || error.status >= 500,
        },
      );

      await mkdir(root, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await writeFile(temporary, bytes);
      await rename(temporary, file);
      return { bytes, cached: false };
    },
  };
}

export interface DarkEditOptions {
  readonly dryRun: boolean;
  readonly publish: boolean;
  readonly currency: string;
}

export interface DarkEditReport {
  provider: string;
  startedAt: string;
  finishedAt: string;
  options: DarkEditOptions;
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
  categoriesCreated: string[];
  variantsCreated: number;
  imagesCreated: number;
  inventoryMovementsCreated: number;
  failures: { externalId: string; stage: string; message: string }[];
}

export interface DarkEditDependencies {
  readonly db: PrismaClient;
  readonly storage: ObjectStorage;
  readonly photos: PhotoSource;
  readonly manifest: DarkEditManifest;
}

/**
 * Sequential on purpose: 40 photos, and a polite pause between CDN downloads. Every product
 * gets synthetic price and stock (it is a synthetic dataset) under the importer's rerun rule,
 * so running this twice changes nothing.
 */
export async function runDarkEditImport(
  deps: DarkEditDependencies,
  options: DarkEditOptions,
): Promise<DarkEditReport> {
  const { db, storage, photos, manifest } = deps;
  const startedAt = new Date().toISOString();
  const report: DarkEditReport = {
    provider: DARK_EDIT_PROVIDER,
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

  const ordered = [...manifest.products].sort((a, b) => a.rank - b.rank);
  for (const item of ordered) {
    let product = normalizeDarkEditItem(item, manifest);

    // 1. Photo: cache or CDN, verified by content, stored. Never inside a transaction.
    try {
      const fetched = await photos.get(item.photo.id);
      if (fetched.cached) {
        report.photos.cached += 1;
      } else {
        report.photos.downloaded += 1;
        await sleep(250);
      }

      const inspected = inspectImage(fetched.bytes);
      if (!inspected.ok) throw new Error(`photo rejected: ${inspected.reason}`);

      const objectKey = `catalog/${DARK_EDIT_PROVIDER}/${item.id.toLowerCase()}/1.${extensionFor(inspected.info.contentType)}`;
      if (!options.dryRun) {
        if (await storage.exists(objectKey)) {
          report.photos.alreadyInStorage += 1;
        } else {
          await storage.put(objectKey, fetched.bytes, inspected.info.contentType);
          report.photos.stored += 1;
        }
      }

      product = {
        ...product,
        image: {
          objectKey,
          altText: item.photo.alt,
          ...inspected.info,
          sourceUrl: `https://unsplash.com/photos/${item.photo.page}`,
          attribution: photoCredit(item.photo),
        },
      };
    } catch (error) {
      // As with the Kaggle import: no photo means the product imports but stays a draft.
      note(item.id, 'photo', error);
    }

    // 2. Persist: one short transaction.
    try {
      const result = await persistProduct(db, product, {
        dryRun: options.dryRun,
        publish: options.publish,
        demoPricing: { currency: options.currency },
        demoStock: true,
        skuPrefix: DARK_EDIT_SKU_PREFIX,
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
