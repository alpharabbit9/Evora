import { describe, expect, it } from 'vitest';

import {
  ARRIVALS_PROVIDER,
  createCutoutSource,
  cutoutCredit,
  loadArrivals,
  normalizeArrival,
  parseArrivals,
} from '../scripts/catalog-import/arrivals.js';
import { inspectImage } from '../scripts/catalog-import/image-info.js';
import { syntheticPriceMinor } from '../scripts/catalog-import/pricing.js';
import { productArrivalsQuery } from '../src/modules/catalog/catalog.schemas.js';

/** The Recent Arrivals dataset, its committed cut-outs, and the rail's query (ADR 0017). */

describe('arrivals.json', () => {
  it('is a valid set with every category priced', async () => {
    const manifest = await loadArrivals();

    expect(manifest.products.length).toBeGreaterThanOrEqual(4);
    for (const product of manifest.products) {
      expect(syntheticPriceMinor('BDT', product.category, product.id)).toBeGreaterThan(0);
    }
  });

  it('has a committed, transparent-capable cut-out for every product', async () => {
    const manifest = await loadArrivals();
    const cutouts = createCutoutSource();

    for (const product of manifest.products) {
      const inspected = inspectImage(await cutouts.get(product.photo.id));
      expect(inspected.ok, product.id).toBe(true);
      if (inspected.ok) {
        expect(inspected.info.contentType).toBe('image/webp');
        // Tall enough to stay sharp at the rail's largest garment size, on a 2x screen.
        expect(inspected.info.heightPx).toBeGreaterThanOrEqual(800);
      }
    }
  });

  it('refuses a photo used twice and an id outside the AR series', async () => {
    const manifest = await loadArrivals();
    const [first, second] = manifest.products;
    if (!first || !second) throw new Error('fixture needs two products');
    const rest = manifest.products.slice(2);

    expect(() =>
      parseArrivals({ ...manifest, products: [first, { ...second, photo: first.photo }, ...rest] }),
    ).toThrow(/used twice/);
    expect(() =>
      parseArrivals({ ...manifest, products: [first, { ...second, id: 'DE999' }, ...rest] }),
    ).toThrow();
  });
});

describe('normalizeArrival', () => {
  it('maps an item to an unfeatured house-brand product', async () => {
    const manifest = await loadArrivals();
    const item = manifest.products[0];
    if (!item) throw new Error('manifest is empty');

    const product = normalizeArrival(item, manifest);

    expect(product).toMatchObject({
      provider: ARRIVALS_PROVIDER,
      externalId: item.id,
      brand: 'EVORA',
      image: null,
      cutout: null,
    });
    expect(product.featuredRank).toBeUndefined();
    expect(product.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(cutoutCredit(item.photo)).toContain('background removed');
  });
});

describe('productArrivalsQuery', () => {
  it('defaults to eight and caps at twelve', () => {
    expect(productArrivalsQuery.parse({}).limit).toBe(8);
    expect(productArrivalsQuery.safeParse({ limit: '13' }).success).toBe(false);
    expect(productArrivalsQuery.safeParse({ page: '1' }).success).toBe(false);
  });
});
