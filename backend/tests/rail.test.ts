import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { inspectImage } from '../scripts/catalog-import/image-info.js';
import { syntheticPriceMinor } from '../scripts/catalog-import/pricing.js';
import {
  RAIL_PROVIDER,
  RAIL_VIEWS,
  createRailPhotoSource,
  loadRail,
  normalizeRailItem,
  parseRail,
} from '../scripts/catalog-import/rail.js';

/** The clothes-rail products, their committed photos, and the rail's links to them (ADR 0027). */

const FRONTEND_RAIL_DATA = new URL(
  '../../frontend/src/components/storefront/recent-arrivals/arrivals-data.ts',
  import.meta.url,
);

describe('rail.json', () => {
  it('is a valid set with every category priced', async () => {
    const manifest = await loadRail();

    expect(manifest.products.length).toBeGreaterThanOrEqual(1);
    for (const product of manifest.products) {
      expect(syntheticPriceMinor('BDT', product.category, product.id)).toBeGreaterThan(0);
    }
  });

  it('has a committed 4:5 WebP front and side photo for every product', async () => {
    const manifest = await loadRail();
    const photos = createRailPhotoSource();

    for (const product of manifest.products) {
      for (const view of RAIL_VIEWS) {
        const inspected = inspectImage(await photos.get(product.look, view));
        expect(inspected.ok, `${product.id} ${view}`).toBe(true);
        if (inspected.ok) {
          expect(inspected.info.contentType).toBe('image/webp');
          expect(inspected.info.widthPx / inspected.info.heightPx).toBeCloseTo(0.8, 2);
          // Sharp in the product gallery's main slot on a 2x screen.
          expect(inspected.info.heightPx).toBeGreaterThanOrEqual(1200);
        }
      }
    }
  });

  it('refuses a look used twice and an id outside the RL series', async () => {
    const manifest = await loadRail();
    const [first, second] = manifest.products;
    if (!first || !second) throw new Error('fixture needs two products');
    const rest = manifest.products.slice(2);

    expect(() =>
      parseRail({ ...manifest, products: [first, { ...second, look: first.look }, ...rest] }),
    ).toThrow(/used twice/);
    expect(() =>
      parseRail({ ...manifest, products: [first, { ...second, id: 'AR999' }, ...rest] }),
    ).toThrow();
    expect(() =>
      parseRail({ ...manifest, products: [{ ...first, look: '../secrets' }, ...rest] }),
    ).toThrow();
  });
});

describe('normalizeRailItem', () => {
  it('maps an item to an unfeatured house-brand product with no images yet', async () => {
    const manifest = await loadRail();
    const item = manifest.products[0];
    if (!item) throw new Error('manifest is empty');

    const product = normalizeRailItem(item, manifest);

    expect(product).toMatchObject({
      provider: RAIL_PROVIDER,
      externalId: item.id,
      brand: 'EVORA',
      image: null,
      gallery: [],
      cutout: null,
    });
    expect(product.featuredRank).toBeUndefined();
    expect(product.slug).toBe(`${product.slug.replace(/-rl\d{3}$/, '')}-${item.id.toLowerCase()}`);
  });
});

describe('the home page rail', () => {
  it('links every garment to a product this importer creates, under the same name', async () => {
    const manifest = await loadRail();
    const products = new Map(
      manifest.products.map((item) => {
        const product = normalizeRailItem(item, manifest);
        return [item.look, product] as const;
      }),
    );
    const source = await readFile(FRONTEND_RAIL_DATA, 'utf8');
    const pieces = [
      ...source.matchAll(/slug: '([^']+)',\s*productSlug: '([^']+)',\s*name: '([^']+)'/g),
    ].map(([, look, productSlug, name]) => ({ look, productSlug, name }));

    expect(pieces.length).toBe(manifest.products.length);
    for (const piece of pieces) {
      const product = products.get(piece.look ?? '');
      expect(product, piece.look).toBeDefined();
      expect(piece.productSlug).toBe(product?.slug);
      expect(piece.name).toBe(product?.name);
    }
  });
});
