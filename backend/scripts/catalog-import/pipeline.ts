import type { PrismaClient } from '@prisma/client';

import type { ObjectStorage } from '../../src/lib/storage.js';
import { extensionFor, inspectImage } from './image-info.js';
import { cleanName, mapGender, normalizeSizes, productSlug } from './normalize.js';
import { persistProduct, type PersistOptions } from './persist.js';
import {
  DATASET_URL,
  IMAGE_ATTRIBUTION,
  KAGGLE_DATASET,
  PROVIDER,
  parseStylesCsv,
  type SourceFiles,
} from './source-fpi.js';
import { CATEGORY_CAPS, classify } from './taxonomy.js';
import type { NormalizedProduct, SourceDetail, SourceRow } from './types.js';

/**
 * acquire → parse → validate → classify → dedupe → cap → details → images → normalise →
 * persist → report. See docs/fashion-catalog-integration-plan.md §5.
 *
 * Acquisition (network, local cache) and persistence (database) are separate steps: every file
 * is on disk before the first transaction opens, and `stage: 'acquire'` stops there.
 */
export interface ImportLog {
  info(details: object, message: string): void;
  warn(details: object, message: string): void;
}

export interface ImportOptions extends Omit<PersistOptions, 'skuPrefix'> {
  /** `acquire`: download and validate only — no storage or database writes. */
  readonly stage: 'acquire' | 'all';
  readonly limit: number | null;
  readonly categories: readonly string[] | null;
  readonly concurrency: number;
}

export interface ImportDependencies {
  readonly db: PrismaClient;
  readonly storage: ObjectStorage;
  readonly source: SourceFiles;
  readonly log: ImportLog;
}

type Tally = Record<string, number>;

export interface ImportReport {
  provider: string;
  dataset: string;
  startedAt: string;
  finishedAt: string;
  options: ImportOptions;
  source: {
    rowsExamined: number;
    invalidRows: number;
    duplicateIds: number;
    excluded: Tally;
    eligible: number;
    duplicateNames: number;
    cappedOut: number;
    selected: number;
  };
  acquisition: {
    detailsDownloaded: number;
    detailsCached: number;
    imagesDownloaded: number;
    imagesCached: number;
  };
  images: { stored: number; alreadyInStorage: number; missing: number; rejected: Tally };
  products: {
    inserted: number;
    updated: number;
    unchanged: number;
    skippedLocalOverride: number;
    failed: number;
    published: number;
  };
  categoriesCreated: string[];
  variantsCreated: number;
  imagesCreated: number;
  inventoryMovementsCreated: number;
  /** Imported earlier, absent from this run's selection. Reported, never deleted. */
  notSeenThisRun: number | null;
  distribution: { byGender: Tally; byCategory: Tally; byColour: Tally };
  /** Products from this source now in the database (after the run; unchanged by a dry run). */
  databaseTotals: { products: number; published: number; variants: number; images: number } | null;
  invalidSamples: { line: number; externalId: string | null; issues: string }[];
  failures: { externalId: string; stage: string; message: string }[];
}

const SKU_PREFIX = 'FPI';
const DOWNLOAD_SLACK = 1.15;
const MAX_LISTED = 200;

function bump(tally: Tally, key: string, by = 1): void {
  tally[key] = (tally[key] ?? 0) + by;
}

async function mapPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Take one from each group in turn, so a cap or limit keeps the mix rather than the first group. */
function roundRobin<T>(groups: readonly (readonly T[])[]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longest; index += 1) {
    for (const group of groups) {
      const item = group[index];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

interface Candidate {
  readonly row: SourceRow;
  readonly categorySlug: string;
}

/** Newest catalog year first, then highest id; women first so a cap does not crowd them out. */
function orderWithinCategory(candidates: readonly Candidate[]): Candidate[] {
  const byNewest = (a: Candidate, b: Candidate) =>
    (b.row.year ?? 0) - (a.row.year ?? 0) || Number(b.row.externalId) - Number(a.row.externalId);
  const genders = ['Women', 'Men', 'Unisex'];
  return roundRobin(
    genders.map((gender) => candidates.filter((c) => c.row.gender === gender).sort(byNewest)),
  );
}

function groupByCategory(candidates: readonly Candidate[]): Map<string, Candidate[]> {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.categorySlug) ?? [];
    group.push(candidate);
    groups.set(candidate.categorySlug, group);
  }
  return groups;
}

export function normalizeProduct(
  row: SourceRow,
  categorySlug: string,
  detail: SourceDetail,
): NormalizedProduct | null {
  const gender = mapGender(row.gender);
  if (!gender) return null;
  const name = cleanName(row.name);
  return {
    provider: PROVIDER,
    externalId: row.externalId,
    name,
    slug: productSlug(name, row.externalId),
    description: detail.description,
    brand: detail.brand,
    gender,
    categorySlug,
    colour: row.baseColour.trim(),
    sizes: normalizeSizes(detail.sizes),
    sourceUrl: detail.landingPath
      ? `https://www.myntra.com/${detail.landingPath.replace(/^\/+/, '')}`
      : null,
    image: null,
  };
}

export async function runCatalogImport(
  deps: ImportDependencies,
  options: ImportOptions,
): Promise<ImportReport> {
  const { db, storage, source, log } = deps;
  const startedAt = new Date().toISOString();
  const report: ImportReport = {
    provider: PROVIDER,
    dataset: DATASET_URL,
    startedAt,
    finishedAt: startedAt,
    options,
    source: {
      rowsExamined: 0,
      invalidRows: 0,
      duplicateIds: 0,
      excluded: {},
      eligible: 0,
      duplicateNames: 0,
      cappedOut: 0,
      selected: 0,
    },
    acquisition: { detailsDownloaded: 0, detailsCached: 0, imagesDownloaded: 0, imagesCached: 0 },
    images: { stored: 0, alreadyInStorage: 0, missing: 0, rejected: {} },
    products: {
      inserted: 0,
      updated: 0,
      unchanged: 0,
      skippedLocalOverride: 0,
      failed: 0,
      published: 0,
    },
    categoriesCreated: [],
    variantsCreated: 0,
    imagesCreated: 0,
    inventoryMovementsCreated: 0,
    notSeenThisRun: null,
    distribution: { byGender: {}, byCategory: {}, byColour: {} },
    databaseTotals: null,
    invalidSamples: [],
    failures: [],
  };
  const fail = (externalId: string, stage: string, error: unknown) => {
    if (report.failures.length < MAX_LISTED) {
      report.failures.push({
        externalId,
        stage,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  // 1. Parse and validate the index.
  const { rows, invalid } = parseStylesCsv(await source.stylesCsv());
  report.source.rowsExamined = rows.length + invalid.length;
  report.source.invalidRows = invalid.length;
  report.invalidSamples = invalid.slice(0, MAX_LISTED);

  // 2. Classify; the first occurrence of an id wins.
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const eligible: Candidate[] = [];
  for (const row of rows) {
    if (seenIds.has(row.externalId)) {
      report.source.duplicateIds += 1;
      continue;
    }
    seenIds.add(row.externalId);

    const verdict = classify(row);
    if (!verdict.included) {
      bump(report.source.excluded, verdict.reason);
      continue;
    }
    if (options.categories && !options.categories.includes(verdict.categorySlug)) {
      bump(report.source.excluded, 'category_filter');
      continue;
    }
    // Identical title + colour + line in one category reads as a duplicate listing on a shelf.
    const nameKey = `${verdict.categorySlug}|${row.gender}|${row.baseColour}|${cleanName(row.name).toLowerCase()}`;
    if (seenNames.has(nameKey)) {
      report.source.duplicateNames += 1;
      continue;
    }
    seenNames.add(nameKey);
    eligible.push({ row, categorySlug: verdict.categorySlug });
  }
  report.source.eligible = eligible.length;

  // 3. Shortlist per category with some slack, because details can still exclude rows.
  const grouped = groupByCategory(eligible);
  const shortlistGroups = [...grouped.entries()].map(([slug, group]) =>
    orderWithinCategory(group).slice(0, Math.ceil((CATEGORY_CAPS[slug] ?? 100) * DOWNLOAD_SLACK)),
  );
  let shortlist = roundRobin(shortlistGroups);
  if (options.limit !== null)
    shortlist = shortlist.slice(0, Math.ceil(options.limit * DOWNLOAD_SLACK));
  log.info(
    { eligible: eligible.length, shortlist: shortlist.length },
    'catalog-import: fetching style details',
  );

  // 4. Details (cached or downloaded).
  let done = 0;
  const detailed = await mapPool(shortlist, options.concurrency, async (candidate) => {
    try {
      const result = await source.detail(candidate.row.externalId);
      done += 1;
      if (done % 250 === 0) log.info({ done, of: shortlist.length }, 'catalog-import: details');
      if (!result) {
        bump(report.source.excluded, 'missing_detail');
        return null;
      }
      if (result.cached) report.acquisition.detailsCached += 1;
      else report.acquisition.detailsDownloaded += 1;
      // The CSV can say "Women" for girls' wear; the detail's age group settles it.
      if (result.detail.ageGroup && !/^adults/i.test(result.detail.ageGroup)) {
        bump(report.source.excluded, 'not_adult_line');
        return null;
      }
      return { ...candidate, detail: result.detail };
    } catch (error) {
      fail(candidate.row.externalId, 'detail', error);
      report.products.failed += 1;
      return null;
    }
  });

  // 5. Final selection: re-apply caps after detail exclusions, then the global limit.
  const survivors = detailed.filter(
    (item): item is Candidate & { detail: SourceDetail } => item !== null,
  );
  const finalGroups = [...groupByCategory(survivors).entries()].map(([slug, group]) =>
    group.slice(0, CATEGORY_CAPS[slug] ?? 100),
  );
  let selected = roundRobin(finalGroups) as (Candidate & { detail: SourceDetail })[];
  if (options.limit !== null) selected = selected.slice(0, options.limit);
  report.source.selected = selected.length;
  report.source.cappedOut =
    eligible.length - shortlist.length + (survivors.length - selected.length);

  // 6. Images: download, verify by content, store. Never inside a transaction.
  log.info({ selected: selected.length }, 'catalog-import: fetching and storing images');
  done = 0;
  const products = await mapPool(selected, options.concurrency, async (item) => {
    const normalized = normalizeProduct(item.row, item.categorySlug, item.detail);
    if (!normalized) return null;
    try {
      const fetched = await source.image(item.row.externalId);
      done += 1;
      if (done % 250 === 0) log.info({ done, of: selected.length }, 'catalog-import: images');
      if (!fetched) {
        report.images.missing += 1;
        return normalized;
      }
      if (fetched.cached) report.acquisition.imagesCached += 1;
      else report.acquisition.imagesDownloaded += 1;

      const inspected = inspectImage(fetched.bytes);
      if (!inspected.ok) {
        bump(report.images.rejected, inspected.reason);
        return normalized;
      }

      const objectKey = `catalog/${PROVIDER}/${item.row.externalId}/1.${extensionFor(inspected.info.contentType)}`;
      if (options.stage === 'all' && !options.dryRun) {
        if (await storage.exists(objectKey)) {
          report.images.alreadyInStorage += 1;
        } else {
          await storage.put(objectKey, fetched.bytes, inspected.info.contentType);
          report.images.stored += 1;
        }
      }

      return {
        ...normalized,
        image: {
          objectKey,
          altText: normalized.name,
          ...inspected.info,
          sourceUrl: `kaggle://${KAGGLE_DATASET}/fashion-dataset/images/${item.row.externalId}.jpg`,
          attribution: IMAGE_ATTRIBUTION,
        },
      };
    } catch (error) {
      // A failed image does not sink the product: it imports, but stays unpublishable.
      fail(item.row.externalId, 'image', error);
      return normalized;
    }
  });

  if (options.stage === 'acquire') {
    report.finishedAt = new Date().toISOString();
    return report;
  }

  // 7. Persist, one short transaction per product, sequentially.
  log.info(
    { products: products.length, dryRun: options.dryRun },
    'catalog-import: writing to the database',
  );
  const categoriesCreated = new Set<string>();
  done = 0;
  for (const product of products) {
    if (!product) continue;
    try {
      const result = await persistProduct(db, product, { ...options, skuPrefix: SKU_PREFIX });
      result.categoriesCreated.forEach((slug) => categoriesCreated.add(slug));
      if (result.outcome === 'skipped_local_override') report.products.skippedLocalOverride += 1;
      else report.products[result.outcome] += 1;
      if (result.published) report.products.published += 1;
      report.variantsCreated += result.variantsCreated;
      report.imagesCreated += result.imagesCreated;
      report.inventoryMovementsCreated += result.movementsCreated;
      bump(report.distribution.byGender, product.gender);
      bump(report.distribution.byCategory, product.categorySlug);
      bump(report.distribution.byColour, product.colour);
    } catch (error) {
      report.products.failed += 1;
      fail(product.externalId, 'persist', error);
    }
    done += 1;
    if (done % 250 === 0) log.info({ done, of: products.length }, 'catalog-import: persisted');
  }
  report.categoriesCreated = [...categoriesCreated];

  // 8. Totals and rows this run did not see (only meaningful for an unfiltered run).
  if (options.limit === null && options.categories === null) {
    report.notSeenThisRun = await db.product.count({
      where: {
        sourceProvider: PROVIDER,
        sourceExternalId: { notIn: selected.map((item) => item.row.externalId) },
      },
    });
  }
  const where = { product: { sourceProvider: PROVIDER } };
  report.databaseTotals = {
    products: await db.product.count({ where: { sourceProvider: PROVIDER } }),
    published: await db.product.count({ where: { sourceProvider: PROVIDER, status: 'PUBLISHED' } }),
    variants: await db.productVariant.count({ where }),
    images: await db.productImage.count({ where }),
  };

  report.finishedAt = new Date().toISOString();
  return report;
}
