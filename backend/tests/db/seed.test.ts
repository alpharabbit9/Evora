import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runSeed } from '../../prisma/seed.js';
import { testDb, truncateAll } from './client.js';

/**
 * The seed's one hard promise (PRD FR-08): a rerun must not overwrite operational data.
 * This is the test that makes that promise checkable instead of aspirational.
 */

beforeAll(async () => {
  await truncateAll();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe('development seed', () => {
  it('populates an empty database', async () => {
    const report = await runSeed(testDb);

    expect(report.categories.created).toBeGreaterThan(0);
    expect(report.products.created).toBeGreaterThan(0);
    expect(report.variants.created).toBeGreaterThan(0);
    expect(report.categories.existing).toBe(0);
    // No SEED_ADMIN_PASSWORD and no admin creation in tests, so this step stands down.
    expect(report.admin).toBe('skipped');
  });

  it('leaves stock and price untouched on a rerun', async () => {
    const before = await testDb.productVariant.findFirstOrThrow({ orderBy: { sku: 'asc' } });

    await testDb.productVariant.update({
      where: { id: before.id },
      data: { stockQuantity: 1, priceMinor: 12_345, lowStockThreshold: 99 },
    });

    const report = await runSeed(testDb);

    const after = await testDb.productVariant.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.stockQuantity).toBe(1);
    expect(after.priceMinor).toBe(12_345);
    expect(after.lowStockThreshold).toBe(99);

    expect(report.variants.created).toBe(0);
    expect(report.variants.existing).toBeGreaterThan(0);
    expect(report.operationalFieldsWrittenOnExistingRows).toBe(0);
  });

  it('does not republish a product an admin archived', async () => {
    const product = await testDb.product.findFirstOrThrow({ where: { status: 'PUBLISHED' } });

    await testDb.product.update({ where: { id: product.id }, data: { status: 'ARCHIVED' } });
    await runSeed(testDb);

    const after = await testDb.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.status).toBe('ARCHIVED');
  });

  it('does not duplicate rows on a third run', async () => {
    const counts = async () => ({
      categories: await testDb.category.count(),
      products: await testDb.product.count(),
      variants: await testDb.productVariant.count(),
    });

    const before = await counts();
    await runSeed(testDb);
    expect(await counts()).toEqual(before);
  });

  it('refreshes descriptive copy, which is safe to overwrite', async () => {
    const product = await testDb.product.findFirstOrThrow({ orderBy: { slug: 'asc' } });
    await testDb.product.update({ where: { id: product.id }, data: { description: 'stale' } });

    await runSeed(testDb);

    const after = await testDb.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(after.description).not.toBe('stale');
  });
});
