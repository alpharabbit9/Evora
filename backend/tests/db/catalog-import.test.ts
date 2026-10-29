import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { persistProduct, type PersistOptions } from '../../scripts/catalog-import/persist.js';
import { runCatalogImport, type ImportOptions } from '../../scripts/catalog-import/pipeline.js';
import { PROVIDER, type SourceFiles } from '../../scripts/catalog-import/source-fpi.js';
import type { NormalizedProduct, SourceDetail } from '../../scripts/catalog-import/types.js';
import type { ObjectStorage } from '../../src/lib/storage.js';
import { publicProductWhere } from '../../src/modules/catalog/publication.js';
import { testDb, truncateAll } from './client.js';

/**
 * The importer's promises, checked against a real PostgreSQL (plan §5.2, ADR 0011):
 * a rerun creates nothing twice and never overwrites price, stock or publication; an admin's
 * copy edit survives; a dry run leaves no trace; one bad record fails alone.
 */

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await testDb.$disconnect();
});

const PRICED: PersistOptions = {
  dryRun: false,
  publish: true,
  demoPricing: { currency: 'BDT' },
  demoStock: true,
  skuPrefix: 'FPI',
};

function product(overrides: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    provider: PROVIDER,
    externalId: '1001',
    name: 'Roadster Men Black T-shirt',
    slug: 'roadster-men-black-t-shirt-1001',
    description: 'Soft cotton jersey.',
    brand: 'Roadster',
    gender: 'MEN',
    categorySlug: 't-shirts',
    colour: 'Black',
    sizes: ['S', 'M', 'L'],
    sourceUrl: 'https://www.myntra.com/x/1001/buy',
    image: {
      objectKey: 'catalog/fashion-product-images/1001/1.jpg',
      altText: 'Roadster Men Black T-shirt',
      widthPx: 1080,
      heightPx: 1440,
      byteSize: 120_000,
      contentType: 'image/jpeg',
      sourceUrl:
        'kaggle://paramaggarwal/fashion-product-images-dataset/fashion-dataset/images/1001.jpg',
      attribution: 'test attribution',
    },
    ...overrides,
  };
}

async function snapshot() {
  return {
    categories: await testDb.category.count(),
    products: await testDb.product.count(),
    variants: await testDb.productVariant.count(),
    images: await testDb.productImage.count(),
    movements: await testDb.inventoryMovement.count(),
  };
}

describe('persistProduct', () => {
  it('creates the category chain, product, one variant per real size, image and stock ledger', async () => {
    const result = await persistProduct(testDb, product(), PRICED);

    expect(result.outcome).toBe('inserted');
    expect(result.categoriesCreated).toEqual(['tops', 't-shirts']);
    expect(result.variantsCreated).toBe(3);
    expect(result.imagesCreated).toBe(1);
    expect(result.published).toBe(true);

    const stored = await testDb.product.findFirstOrThrow({
      include: {
        variants: { orderBy: { sku: 'asc' } },
        images: true,
        category: { include: { parent: true } },
      },
    });
    expect(stored).toMatchObject({
      status: 'PUBLISHED',
      gender: 'MEN',
      sourceProvider: PROVIDER,
      sourceExternalId: '1001',
    });
    expect(stored.publishedAt).not.toBeNull();
    expect(stored.category.parent?.slug).toBe('tops');
    expect(stored.variants.map((variant) => variant.sku)).toEqual([
      'FPI-1001-L',
      'FPI-1001-M',
      'FPI-1001-S',
    ]);
    expect(stored.variants[0]?.options).toEqual({ color: 'Black', size: 'L' });
    expect(new Set(stored.variants.map((variant) => variant.priceMinor)).size).toBe(1);
    expect(stored.variants.every((variant) => variant.priceSource === 'SYNTHETIC')).toBe(true);

    // Ledger reconciles: one movement per stocked variant, matching its balance.
    for (const variant of stored.variants) {
      const movements = await testDb.inventoryMovement.findMany({
        where: { variantId: variant.id },
      });
      if (variant.stockQuantity === 0) {
        expect(movements).toEqual([]);
      } else {
        expect(movements).toHaveLength(1);
        expect(movements[0]).toMatchObject({
          delta: variant.stockQuantity,
          resultingQuantity: variant.stockQuantity,
          reason: 'IMPORT_CORRECTION',
          actorUserId: null,
        });
      }
    }
  });

  it('creates a single variant with no size option when the source lists no sizes', async () => {
    await persistProduct(testDb, product({ sizes: [] }), PRICED);
    const variants = await testDb.productVariant.findMany();
    expect(variants).toHaveLength(1);
    expect(variants[0]).toMatchObject({
      sku: 'FPI-1001',
      optionKey: 'color:black',
      options: { color: 'Black' },
    });
  });

  it('is idempotent and never rewrites operational fields on a rerun', async () => {
    await persistProduct(testDb, product(), PRICED);
    const variant = await testDb.productVariant.findFirstOrThrow({ orderBy: { sku: 'asc' } });
    await testDb.productVariant.update({
      where: { id: variant.id },
      data: { priceMinor: 99_900, stockQuantity: 1, status: 'INACTIVE' },
    });
    await testDb.product.updateMany({ data: { status: 'ARCHIVED' } });
    const before = await snapshot();

    const result = await persistProduct(testDb, product(), PRICED);

    expect(result).toMatchObject({
      outcome: 'unchanged',
      variantsCreated: 0,
      imagesCreated: 0,
      published: false,
    });
    expect(await snapshot()).toEqual(before);
    const after = await testDb.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after).toMatchObject({ priceMinor: 99_900, stockQuantity: 1, status: 'INACTIVE' });
    expect((await testDb.product.findFirstOrThrow()).status).toBe('ARCHIVED');
  });

  it('refreshes source copy, but preserves an admin edit', async () => {
    await persistProduct(testDb, product(), PRICED);

    const refreshed = await persistProduct(
      testDb,
      product({ description: 'Updated by source.' }),
      PRICED,
    );
    expect(refreshed.outcome).toBe('updated');
    expect((await testDb.product.findFirstOrThrow()).description).toBe('Updated by source.');

    await testDb.product.updateMany({ data: { name: 'Merchandiser Title' } });
    const skipped = await persistProduct(testDb, product({ description: 'Source again.' }), PRICED);

    expect(skipped.outcome).toBe('skipped_local_override');
    expect(await testDb.product.findFirstOrThrow()).toMatchObject({
      name: 'Merchandiser Title',
      description: 'Updated by source.',
    });
  });

  it('keeps an unpriced import as a draft with no variants, and adds them on a priced rerun', async () => {
    const unpriced = await persistProduct(testDb, product(), {
      ...PRICED,
      demoPricing: null,
      demoStock: false,
    });
    expect(unpriced).toMatchObject({ outcome: 'inserted', variantsCreated: 0, published: false });
    expect(await testDb.product.findFirstOrThrow()).toMatchObject({
      status: 'DRAFT',
      publishedAt: null,
    });

    const priced = await persistProduct(testDb, product(), PRICED);
    expect(priced).toMatchObject({ outcome: 'unchanged', variantsCreated: 3, published: true });
  });

  it('does not publish a product without an image', async () => {
    const result = await persistProduct(testDb, product({ image: null }), PRICED);
    expect(result.published).toBe(false);
    expect((await testDb.product.findFirstOrThrow()).status).toBe('DRAFT');
  });

  it('does not republish a product an admin unpublished', async () => {
    await persistProduct(testDb, product(), PRICED);
    await testDb.product.updateMany({ data: { status: 'DRAFT' } });

    const result = await persistProduct(testDb, product(), PRICED);

    expect(result.published).toBe(false);
    expect((await testDb.product.findFirstOrThrow()).status).toBe('DRAFT');
  });

  it('writes nothing in dry-run mode, yet reports what would happen', async () => {
    const result = await persistProduct(testDb, product(), { ...PRICED, dryRun: true });

    expect(result).toMatchObject({ outcome: 'inserted', variantsCreated: 3, published: true });
    expect(await snapshot()).toEqual({
      categories: 0,
      products: 0,
      variants: 0,
      images: 0,
      movements: 0,
    });
  });

  it('rolls back the whole product when one write fails', async () => {
    // Another product already owns this SKU, so the variant insert violates the unique index.
    await persistProduct(
      testDb,
      product({ externalId: '2002', slug: 'other-2002', sizes: [] }),
      PRICED,
    );
    await testDb.productVariant.updateMany({ data: { sku: 'FPI-1001-S' } });
    const before = await snapshot();

    await expect(persistProduct(testDb, product(), PRICED)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
});

// --- end to end through the pipeline, with in-memory source and storage -------------------

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x05, 0xa0, 0x04,
  0x38, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const CSV = [
  'id,gender,masterCategory,subCategory,articleType,baseColour,season,year,usage,productDisplayName',
  '1,Men,Apparel,Topwear,Tshirts,Black,Fall,2012,Casual,Roadster Men Black T-shirt',
  '2,Women,Accessories,Bags,Handbags,Black,Fall,2012,Casual,Baggit Women Black Handbag',
  '3,Men,Apparel,Topwear,Tshirts,Yellow,Fall,2012,Casual,Roadster Men Yellow T-shirt',
  '4,Boys,Apparel,Topwear,Tshirts,Black,Fall,2012,Casual,Boys Black T-shirt',
  '5,Men,Footwear,Shoes,Casual Shoes,Brown,Fall,2012,Casual,Woodland Men Brown Boots',
  '6,Men,Accessories,Eyewear,Sunglasses,Black,Fall,2012,Casual,Fastrack Men Sunglasses',
  '1,Men,Apparel,Topwear,Tshirts,Black,Fall,2012,Casual,Duplicate id row',
  'x,Men,Apparel,Topwear,Tshirts,Black,Fall,2012,Casual,Bad id',
].join('\n');

interface FakeSourceOptions {
  missingImage?: string;
  brokenImage?: string;
  /** Ids whose detail or image download throws, as a dropped connection would. */
  failingDetail?: string;
  failingImage?: string;
  /** Extra styles.csv rows; ids 1/5/6 have details. */
  extraRows?: string[];
}

function fakeSource(options: FakeSourceOptions = {}): SourceFiles {
  const details: Record<string, SourceDetail> = {
    '1': {
      brand: 'Roadster',
      description: 'Tee.',
      sizes: ['M', 'L'],
      ageGroup: 'Adults-Men',
      landingPath: 'a/1/buy',
    },
    '2': {
      brand: 'Baggit',
      description: null,
      sizes: ['Onesize'],
      ageGroup: 'Adults-Women',
      landingPath: null,
    },
    '5': {
      brand: 'Woodland',
      description: null,
      sizes: ['7', '8'],
      ageGroup: 'Adults-Men',
      landingPath: null,
    },
    '6': {
      brand: 'Fastrack',
      description: null,
      sizes: [],
      ageGroup: 'Adults-Men',
      landingPath: null,
    },
  };
  return {
    root: '/fake',
    stylesCsv: () => Promise.resolve([CSV, ...(options.extraRows ?? [])].join('\n')),
    detail: (id) => {
      if (id === options.failingDetail) return Promise.reject(new Error('socket hang up'));
      const detail = details[id] ?? (id === '7' ? details['1'] : undefined);
      return Promise.resolve(detail ? { detail, cached: true } : null);
    },
    image: (id) => {
      if (id === options.failingImage) return Promise.reject(new Error('ETIMEDOUT'));
      if (id === options.missingImage) return Promise.resolve(null);
      if (id === options.brokenImage)
        return Promise.resolve({ bytes: Buffer.from('<html>'), cached: true });
      return Promise.resolve({ bytes: JPEG, cached: true });
    },
  };
}

function memoryStorage(): ObjectStorage & { keys: Map<string, Buffer> } {
  const keys = new Map<string, Buffer>();
  return {
    driver: 'filesystem',
    keys,
    exists: (key) => Promise.resolve(keys.has(key)),
    put: (key, body) => {
      keys.set(key, body);
      return Promise.resolve();
    },
  };
}

const silentLog = { info: () => undefined, warn: () => undefined };

const RUN: ImportOptions = {
  stage: 'all',
  dryRun: false,
  publish: true,
  demoPricing: { currency: 'BDT' },
  demoStock: true,
  limit: null,
  categories: null,
  concurrency: 2,
};

describe('runCatalogImport', () => {
  it('imports the curated subset and reports every exclusion', async () => {
    const storage = memoryStorage();
    const report = await runCatalogImport(
      { db: testDb, storage, source: fakeSource(), log: silentLog },
      RUN,
    );

    expect(report.source).toMatchObject({
      rowsExamined: 8,
      invalidRows: 1,
      duplicateIds: 1,
      excluded: { off_palette_colour: 1, not_adult_line: 1 },
      selected: 4,
    });
    expect(report.products).toMatchObject({ inserted: 4, failed: 0, published: 4 });
    // 2 sizes + one-size handbag (1) + 2 boot sizes + sunglasses (1)
    expect(report.variantsCreated).toBe(6);
    expect(report.images.stored).toBe(4);
    expect(storage.keys.size).toBe(4);
    expect(report.distribution.byGender).toEqual({ MEN: 3, WOMEN: 1 });
    expect(report.distribution.byCategory).toMatchObject({
      boots: 1,
      handbags: 1,
      't-shirts': 1,
      sunglasses: 1,
    });
    expect(report.databaseTotals).toEqual({ products: 4, published: 4, variants: 6, images: 4 });
    expect(report.notSeenThisRun).toBe(0);
  });

  it('creates nothing on a second run', async () => {
    const storage = memoryStorage();
    await runCatalogImport({ db: testDb, storage, source: fakeSource(), log: silentLog }, RUN);
    const before = await snapshot();

    const report = await runCatalogImport(
      { db: testDb, storage, source: fakeSource(), log: silentLog },
      RUN,
    );

    expect(report.products).toMatchObject({ inserted: 0, unchanged: 4, published: 0, failed: 0 });
    expect(report.images).toMatchObject({ stored: 0, alreadyInStorage: 4 });
    expect(report.variantsCreated).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('dry run touches neither the database nor storage', async () => {
    const storage = memoryStorage();
    const report = await runCatalogImport(
      { db: testDb, storage, source: fakeSource(), log: silentLog },
      { ...RUN, dryRun: true },
    );

    expect(report.products.inserted).toBe(4);
    expect(storage.keys.size).toBe(0);
    expect(await snapshot()).toEqual({
      categories: 0,
      products: 0,
      variants: 0,
      images: 0,
      movements: 0,
    });
  });

  it('imports a product whose image is missing or invalid, but leaves it unpublished', async () => {
    const report = await runCatalogImport(
      {
        db: testDb,
        storage: memoryStorage(),
        source: fakeSource({ missingImage: '1', brokenImage: '2' }),
        log: silentLog,
      },
      RUN,
    );

    expect(report.images).toMatchObject({ missing: 1, rejected: { unrecognised_format: 1 } });
    expect(report.products).toMatchObject({ inserted: 4, published: 2 });
    const drafts = await testDb.product.findMany({
      where: { status: 'DRAFT' },
      select: { sourceExternalId: true },
    });
    expect(drafts.map((row) => row.sourceExternalId).sort()).toEqual(['1', '2']);
  });

  it('survives a partial network failure, and a healthy rerun completes the import', async () => {
    const storage = memoryStorage();
    const first = await runCatalogImport(
      {
        db: testDb,
        storage,
        source: fakeSource({ failingDetail: '5', failingImage: '6' }),
        log: silentLog,
      },
      RUN,
    );

    // The detail failure costs that product this run; the image failure only its publication.
    expect(first.products).toMatchObject({ inserted: 3, published: 2, failed: 1 });
    expect(first.failures.map((failure) => [failure.externalId, failure.stage]).sort()).toEqual([
      ['5', 'detail'],
      ['6', 'image'],
    ]);
    const stockAfterFirst = await testDb.productVariant.findMany({
      select: { sku: true, stockQuantity: true },
      orderBy: { sku: 'asc' },
    });

    const second = await runCatalogImport(
      { db: testDb, storage, source: fakeSource(), log: silentLog },
      RUN,
    );

    expect(second.products).toMatchObject({ inserted: 1, failed: 0, published: 2 });
    expect(await testDb.product.count({ where: { status: 'PUBLISHED' } })).toBe(4);
    // Products imported by the first run keep their stock untouched.
    const stockAfterSecond = await testDb.productVariant.findMany({
      where: { sku: { in: stockAfterFirst.map((row) => row.sku) } },
      select: { sku: true, stockQuantity: true },
      orderBy: { sku: 'asc' },
    });
    expect(stockAfterSecond).toEqual(stockAfterFirst);
  });

  it('skips a second listing with the same title, colour and line under another id', async () => {
    const report = await runCatalogImport(
      {
        db: testDb,
        storage: memoryStorage(),
        source: fakeSource({
          extraRows: [
            '7,Men,Apparel,Topwear,Tshirts,Black,Fall,2012,Casual,Roadster  Men Black T-shirt',
          ],
        }),
        log: silentLog,
      },
      RUN,
    );

    expect(report.source.duplicateNames).toBe(1);
    expect(await testDb.product.count({ where: { sourceExternalId: '7' } })).toBe(0);
  });

  it('publishes exactly the products the public catalog rule shows', async () => {
    const report = await runCatalogImport(
      {
        db: testDb,
        storage: memoryStorage(),
        source: fakeSource({ missingImage: '1' }),
        log: silentLog,
      },
      RUN,
    );

    const visible = await testDb.product.count({ where: publicProductWhere() });
    expect(report.products.published).toBe(3);
    expect(visible).toBe(report.products.published);
  });

  it('honours --limit and --category', async () => {
    const report = await runCatalogImport(
      { db: testDb, storage: memoryStorage(), source: fakeSource(), log: silentLog },
      { ...RUN, categories: ['t-shirts', 'boots'], limit: 1 },
    );
    expect(report.source.selected).toBe(1);
    expect(report.notSeenThisRun).toBeNull();
    expect(await testDb.product.count()).toBe(1);
  });
});
