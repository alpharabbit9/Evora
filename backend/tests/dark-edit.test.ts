import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  createPhotoSource,
  DARK_EDIT_PROVIDER,
  loadDarkEdit,
  normalizeDarkEditItem,
  parseDarkEdit,
  photoCredit,
  photoUrl,
} from '../scripts/catalog-import/dark-edit.js';
import { syntheticPriceMinor } from '../scripts/catalog-import/pricing.js';
import { orderBySql } from '../src/modules/catalog/catalog.query.js';
import { productListQuery } from '../src/modules/catalog/catalog.schemas.js';

/** The Dark Edit dataset, its adapter, and the `featured` sort it feeds (ADR 0013). */

const temporaryDirs: string[] = [];
afterAll(async () => {
  await Promise.all(temporaryDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('dark-edit.json', () => {
  it('is a valid 35–40 piece edit with ranks 1..n and every category priced', async () => {
    const manifest = await loadDarkEdit();
    const ranks = manifest.products.map((product) => product.rank).sort((a, b) => a - b);

    expect(manifest.products.length).toBeGreaterThanOrEqual(35);
    expect(manifest.products.length).toBeLessThanOrEqual(40);
    expect(ranks).toEqual(manifest.products.map((_, index) => index + 1));
    for (const product of manifest.products) {
      expect(syntheticPriceMinor('BDT', product.category, product.id)).toBeGreaterThan(0);
    }
  });

  it('covers the brief: jackets, blazers, coats, boots and hoodies', async () => {
    const categories = new Set((await loadDarkEdit()).products.map((product) => product.category));
    for (const slug of ['jackets', 'blazers', 'coats', 'boots', 'hoodies']) {
      expect(categories).toContain(slug);
    }
  });

  it('refuses duplicate ranks, unknown categories and non-CDN photo ids', async () => {
    const manifest = await loadDarkEdit();
    const [first, second] = manifest.products;
    if (!first || !second) throw new Error('fixture needs two products');

    const withProducts = (products: unknown[]) =>
      parseDarkEdit({ ...manifest, products: [...products, ...manifest.products.slice(2)] });

    expect(() => withProducts([first, { ...second, rank: first.rank }])).toThrow(/duplicate rank/);
    expect(() => withProducts([first, { ...second, category: 'tuxedos' }])).toThrow(
      /unknown category/,
    );
    expect(() =>
      withProducts([first, { ...second, photo: { ...second.photo, id: '../../etc/passwd' } }]),
    ).toThrow();
  });
});

describe('normalizeDarkEditItem', () => {
  it('maps an item to a featured, house-brand product with a lower-case slug', async () => {
    const manifest = await loadDarkEdit();
    const item = manifest.products.find((product) => product.rank === 1);
    if (!item) throw new Error('rank 1 missing');

    const product = normalizeDarkEditItem(item, manifest);

    expect(product).toMatchObject({
      provider: DARK_EDIT_PROVIDER,
      externalId: item.id,
      brand: 'EVORA',
      featuredRank: 1,
      sourceUrl: null,
      image: null,
    });
    expect(product.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(product.sizes.length).toBeGreaterThan(0);
    expect(photoCredit(item.photo)).toContain(`on Unsplash`);
  });
});

describe('createPhotoSource', () => {
  it('downloads once from the Unsplash CDN, then serves the cache', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dark-edit-'));
    temporaryDirs.push(dir);
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(new Response(Buffer.from('jpeg-bytes'))),
    );
    const photos = createPhotoSource(dir, fetchMock as unknown as typeof fetch);

    const first = await photos.get('1551028719-00167b16eac5');
    const second = await photos.get('1551028719-00167b16eac5');

    expect(first).toMatchObject({ cached: false });
    expect(second).toMatchObject({ cached: true });
    expect(second.bytes.toString()).toBe('jpeg-bytes');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(photoUrl('1551028719-00167b16eac5'));
    expect(new URL(photoUrl('x')).host).toBe('images.unsplash.com');
  });

  it('does not retry a 404: a wrong id stays wrong', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'dark-edit-'));
    temporaryDirs.push(dir);
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve(new Response('missing', { status: 404 })),
    );
    const photos = createPhotoSource(dir, fetchMock as unknown as typeof fetch);

    await expect(photos.get('1551028719-00167b16eac5')).rejects.toThrow(/HTTP 404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('featured sort', () => {
  it('is allow-listed and is the default order of a plain listing', () => {
    expect(productListQuery.parse({ sort: 'featured' }).sort).toBe('featured');
    expect(orderBySql(undefined, undefined).sql).toContain('featured_rank ASC NULLS LAST');
    expect(orderBySql('newest', undefined).sql).not.toContain('featured_rank');
  });

  it('breaks relevance ties by featured rank', () => {
    const sql = orderBySql(undefined, 'black boots').sql;
    expect(sql.indexOf('ILIKE')).toBeLessThan(sql.indexOf('featured_rank'));
  });
});
