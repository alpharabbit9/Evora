import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import { PRIVATE_FIELDS, allKeys, makeCategory, makeProduct } from './catalog-fixtures.js';
import { API, createTestApp, truncateAll } from './harness.js';

/**
 * The public catalog against a real database: the publication rule, every filter, sorting,
 * pagination, facets, categories, and that nothing private leaves the API.
 *
 * Each hidden fixture differs from a visible product in exactly one property, so a failure
 * names the rule that leaked.
 */
const app = createTestApp();

const visible: Record<
  'boots' | 'womensBoots' | 'sneakers',
  { slug: string; variantIds: string[] }
> = {} as never;
const hidden: Record<string, string> = {};

beforeAll(async () => {
  await truncateAll();

  const footwear = await makeCategory('footwear', { name: 'Footwear' });
  const boots = await makeCategory('boots', { parentId: footwear.id, name: 'Boots' });
  const sneakers = await makeCategory('sneakers', { parentId: footwear.id, name: 'Sneakers' });
  const switchedOff = await makeCategory('switched-off', { isActive: false });
  const dormantParent = await makeCategory('dormant-parent', { isActive: false });
  const liveChild = await makeCategory('live-child', { parentId: dormantParent.id });
  await makeCategory('empty-shelf', { name: 'Empty shelf' });

  const mensBoots = await makeProduct({
    categoryId: boots.id,
    name: 'Clarks Men Black Leather Boots',
    brand: 'Clarks',
    gender: 'MEN',
    provenance: true,
    variants: [
      { color: 'Black', size: 'UK8', priceMinor: 500_000, stockQuantity: 5, lowStockThreshold: 5 },
      { color: 'Black', size: 'UK9', priceMinor: 500_000, stockQuantity: 0 },
      { color: 'Black', size: 'UK10', priceMinor: 500_000, status: 'ARCHIVED' },
    ],
  });
  const womensBoots = await makeProduct({
    categoryId: boots.id,
    name: 'Carlton Women Brown Ankle Boots',
    brand: 'Carlton',
    gender: 'WOMEN',
    featuredRank: 1,
    variants: [{ color: 'Brown', size: 'UK7', priceMinor: 400_000, stockQuantity: 3 }],
  });
  const unisexSneakers = await makeProduct({
    categoryId: sneakers.id,
    name: 'Converse Unisex Canvas Shoe',
    brand: 'Converse',
    gender: 'UNISEX',
    description: 'Wear them with black jeans.',
    featuredRank: 2,
    variants: [
      { color: 'Black', size: 'uk8', priceMinor: 300_000, stockQuantity: 0 },
      { color: 'Black', size: 'UK9', priceMinor: 300_000, stockQuantity: 2 },
    ],
  });

  visible.boots = { slug: mensBoots.product.slug, variantIds: mensBoots.variants.map((v) => v.id) };
  visible.womensBoots = {
    slug: womensBoots.product.slug,
    variantIds: womensBoots.variants.map((v) => v.id),
  };
  visible.sneakers = {
    slug: unisexSneakers.product.slug,
    variantIds: unisexSneakers.variants.map((v) => v.id),
  };

  const hide = async (key: string, spec: Parameters<typeof makeProduct>[0]) => {
    hidden[key] = (await makeProduct({ name: `Hidden ${key} black boots`, ...spec })).product.slug;
  };

  await hide('draft', { categoryId: boots.id, status: 'DRAFT' });
  await hide('archived', { categoryId: boots.id, status: 'ARCHIVED' });
  await hide('future', { categoryId: boots.id, publishedAt: new Date(Date.now() + 86_400_000) });
  await hide('noImage', { categoryId: boots.id, images: 0 });
  await hide('noActiveVariant', { categoryId: boots.id, variants: [{ status: 'INACTIVE' }] });
  await hide('zeroPrice', { categoryId: boots.id, variants: [{ priceMinor: 0 }] });
  await hide('inactiveCategory', { categoryId: switchedOff.id });
  await hide('inactiveParent', { categoryId: liveChild.id });
});

afterAll(async () => {
  await prisma.$disconnect();
});

const slugsOf = (body: unknown) =>
  (body as { data: { slug: string }[] }).data.map((item) => item.slug);

describe('publication rule', () => {
  it('lists only products that pass every rule', async () => {
    const res = await request(app).get(`${API}/products`);

    expect(res.status).toBe(200);
    expect(res.body.meta).toMatchObject({ page: 1, pageSize: 24, total: 3 });
    expect(slugsOf(res.body).sort()).toEqual(
      [visible.boots.slug, visible.womensBoots.slug, visible.sneakers.slug].sort(),
    );
  });

  it.each([
    'draft',
    'archived',
    'future',
    'noImage',
    'noActiveVariant',
    'zeroPrice',
    'inactiveCategory',
    'inactiveParent',
  ])('answers 404 for the %s product, exactly like a slug that never existed', async (key) => {
    const res = await request(app).get(`${API}/products/${hidden[key] ?? ''}`);
    const missing = await request(app).get(`${API}/products/no-such-product-1`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe(missing.body.error.message);
  });

  it('keeps hidden products out of search and facets', async () => {
    const search = await request(app).get(`${API}/products`).query({ q: 'hidden' });
    const facets = await request(app).get(`${API}/products/facets`);

    expect(search.body.meta.total).toBe(0);
    expect(facets.body.data.total).toBe(3);
  });
});

describe('product detail', () => {
  it('returns purchasable variants with availability states, in size order', async () => {
    const res = await request(app).get(`${API}/products/${visible.boots.slug}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Clarks Men Black Leather Boots',
      brand: 'Clarks',
      gender: 'men',
      currency: 'BDT',
      priceMinor: 500_000,
      colors: ['Black'],
      sizes: ['UK8', 'UK9'],
      inStock: true,
      category: { slug: 'boots', name: 'Boots', parent: { slug: 'footwear', name: 'Footwear' } },
    });
    // The ARCHIVED UK10 variant is not offered at all.
    expect(
      (
        res.body as { data: { variants: { size: string; availability: string }[] } }
      ).data.variants.map((v) => [v.size, v.availability]),
    ).toEqual([
      ['UK8', 'low_stock'],
      ['UK9', 'out_of_stock'],
    ]);
    expect(res.body.data.images[0].url).toMatch(/\/media\/catalog\/test\/[^/]+\/1\.jpg$/);
  });

  it('never returns stock counts, provenance or other internal fields', async () => {
    const detail = await request(app).get(`${API}/products/${visible.boots.slug}`);
    const list = await request(app).get(`${API}/products`);
    const facets = await request(app).get(`${API}/products/facets`);
    const categories = await request(app).get(`${API}/categories`);

    for (const body of [detail.body, list.body, facets.body, categories.body]) {
      const keys = allKeys(body.data);
      for (const field of PRIVATE_FIELDS) {
        expect(keys.has(field), `${field} leaked`).toBe(false);
      }
      expect(JSON.stringify(body)).not.toContain('SYNTHETIC');
      expect(JSON.stringify(body)).not.toContain('test-provider');
    }
  });

  it('validates the slug', async () => {
    const res = await request(app).get(`${API}/products/Not_A_Slug`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('listing filters', () => {
  const list = async (query: Record<string, string>) =>
    (await request(app).get(`${API}/products`).query(query)).body as {
      data: { slug: string; priceMinor: number }[];
      meta: { total: number };
    };

  it('includes unisex items in the men and women collections', async () => {
    expect(slugsOf(await list({ gender: 'men' })).sort()).toEqual(
      [visible.boots.slug, visible.sneakers.slug].sort(),
    );
    expect(slugsOf(await list({ gender: 'women' })).sort()).toEqual(
      [visible.womensBoots.slug, visible.sneakers.slug].sort(),
    );
    expect(slugsOf(await list({ gender: 'unisex' }))).toEqual([visible.sneakers.slug]);
  });

  it('treats a parent category as including its children', async () => {
    expect((await list({ category: 'footwear' })).meta.total).toBe(3);
    expect(slugsOf(await list({ category: 'boots' })).sort()).toEqual(
      [visible.boots.slug, visible.womensBoots.slug].sort(),
    );
    expect((await list({ category: 'switched-off' })).meta.total).toBe(0);
  });

  it('applies colour, size, price and stock to ONE variant at a time', async () => {
    // The men's boots have UK9 only sold out, so "UK9 in stock" is the sneakers alone.
    expect(slugsOf(await list({ size: 'UK9', inStock: 'true' }))).toEqual([visible.sneakers.slug]);
    // Without the stock condition both have a UK9.
    expect((await list({ size: 'UK9' })).meta.total).toBe(2);
    // Sizes match case-insensitively (the sneakers store `uk8`).
    expect((await list({ size: 'UK8' })).meta.total).toBe(2);
    expect(slugsOf(await list({ color: 'Brown' }))).toEqual([visible.womensBoots.slug]);
    expect(slugsOf(await list({ color: 'Brown', size: 'UK9' }))).toEqual([]);
  });

  it('filters by price range in minor units and by brand', async () => {
    expect(slugsOf(await list({ maxPrice: '350000' }))).toEqual([visible.sneakers.slug]);
    expect((await list({ minPrice: '400000', maxPrice: '500000' })).meta.total).toBe(2);
    expect(slugsOf(await list({ brand: 'Carlton,Converse' })).sort()).toEqual(
      [visible.womensBoots.slug, visible.sneakers.slug].sort(),
    );
  });

  it('lists featured products first, by rank, by default and on sort=featured', async () => {
    // Not creation order (newest would put the sneakers first), so the rank is what decides.
    const expected = [visible.womensBoots.slug, visible.sneakers.slug, visible.boots.slug];

    expect(slugsOf(await list({}))).toEqual(expected);
    expect(slugsOf(await list({ sort: 'featured' }))).toEqual(expected);
    // A filter keeps the featured order inside its own results.
    expect(slugsOf(await list({ category: 'boots' }))).toEqual([
      visible.womensBoots.slug,
      visible.boots.slug,
    ]);
  });

  it('sorts by price both ways and paginates with a stable total', async () => {
    expect((await list({ sort: 'price_asc' })).data.map((item) => item.priceMinor)).toEqual([
      300_000, 400_000, 500_000,
    ]);
    expect((await list({ sort: 'price_desc' })).data.map((item) => item.priceMinor)).toEqual([
      500_000, 400_000, 300_000,
    ]);

    const second = await list({ sort: 'price_asc', pageSize: '2', page: '2' });
    expect(second.meta.total).toBe(3);
    expect(second.data.map((item) => item.priceMinor)).toEqual([500_000]);

    const beyond = await list({ page: '9' });
    expect(beyond.meta.total).toBe(3);
    expect(beyond.data).toEqual([]);
  });

  it('searches name, brand, category, colour and description, every word required', async () => {
    expect(slugsOf(await list({ q: 'clarks' }))).toEqual([visible.boots.slug]);
    expect((await list({ q: 'boots' })).meta.total).toBe(2);
    // "black" is a colour of the men's boots and in the sneakers' description.
    const blackBoots = await list({ q: 'black boots' });
    expect(slugsOf(blackBoots)).toEqual([visible.boots.slug]);
    expect((await list({ q: 'jeans' })).meta.total).toBe(1);
    expect((await list({ q: 'boots sandals' })).meta.total).toBe(0);
  });

  it('treats LIKE wildcards in a search as literal text', async () => {
    const res = await request(app).get(`${API}/products`).query({ q: '%_\\' });
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
  });

  it('rejects invalid filters with field details', async () => {
    const res = await request(app)
      .get(`${API}/products`)
      .query({ sort: 'rating', colour: 'Black' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.length).toBeGreaterThan(0);
  });
});

describe('facets and categories', () => {
  it('counts products per option for the scope', async () => {
    const res = await request(app).get(`${API}/products/facets`).query({ gender: 'men' });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      total: 2,
      currency: 'BDT',
      price: { minMinor: 300_000, maxMinor: 500_000 },
      colors: [{ value: 'Black', count: 2 }],
      sizes: [
        { value: 'UK8', count: 2 },
        { value: 'UK9', count: 2 },
      ],
    });
    expect(res.body.data.categories).toEqual(
      expect.arrayContaining([
        { slug: 'boots', name: 'Boots', count: 1 },
        { slug: 'sneakers', name: 'Sneakers', count: 1 },
      ]),
    );
  });

  it('lists active categories that have public products, as a tree with counts', async () => {
    const res = await request(app).get(`${API}/categories`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        slug: 'footwear',
        name: 'Footwear',
        description: null,
        productCount: 3,
        children: [
          { slug: 'boots', name: 'Boots', description: null, productCount: 2 },
          { slug: 'sneakers', name: 'Sneakers', description: null, productCount: 1 },
        ],
      },
    ]);
  });
});
