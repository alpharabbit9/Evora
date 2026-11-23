import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import { allKeys, makeCategory, makeProduct, PRIVATE_FIELDS } from './catalog-fixtures.js';
import { API, createTestApp, truncateAll } from './harness.js';

const app = createTestApp();
const SUGGEST = `${API}/search/suggestions`;

interface Suggestions {
  products: { slug: string; name: string; priceMinor: number }[];
  categories: { slug: string; name: string; parentName: string | null }[];
  totalProducts: number;
}

function suggest(q: string) {
  return request(app).get(SUGGEST).query({ q });
}

beforeAll(async () => {
  await truncateAll();
  const footwear = await makeCategory('suggest-footwear', { name: 'Footwear' });
  const boots = await makeCategory('suggest-boots', { name: 'Boots', parentId: footwear.id });
  const hiddenShelf = await makeCategory('suggest-boot-trees', {
    name: 'Boot Trees',
    isActive: false,
  });

  await makeProduct({
    categoryId: boots.id,
    name: 'Chelsea Boot',
    variants: [{ priceMinor: 500_000 }],
  });
  await makeProduct({ categoryId: boots.id, name: 'Engineer Boot' });
  await makeProduct({ categoryId: boots.id, name: 'Draft Boot', status: 'DRAFT' });
  await makeProduct({ categoryId: boots.id, name: 'Photo-less Boot', images: 0 });
  await makeProduct({ categoryId: hiddenShelf.id, name: 'Cedar Boot Tree' });
  for (let index = 0; index < 6; index += 1) {
    await makeProduct({ categoryId: footwear.id, name: `Running Boot ${String(index)}` });
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /search/suggestions', () => {
  it('is public and suggests at most five products, with the full count', async () => {
    const res = await suggest('boot');

    expect(res.status).toBe(200);
    const data = (res.body as { data: Suggestions }).data;
    expect(data.products).toHaveLength(5);
    // Chelsea, Engineer and six Running boots. Never the draft, the photo-less one or the one
    // on a switched-off shelf.
    expect(data.totalProducts).toBe(8);
  });

  it('suggests exactly what the search page would list first', async () => {
    const [suggested, listed] = await Promise.all([
      suggest('chelsea'),
      request(app).get(`${API}/products`).query({ q: 'chelsea', pageSize: 5 }),
    ]);

    const names = (suggested.body as { data: Suggestions }).data.products.map((p) => p.name);
    const listedNames = (listed.body as { data: { name: string }[] }).data.map((p) => p.name);
    expect(names).toEqual(['Chelsea Boot']);
    expect(names).toEqual(listedNames);
  });

  it('never suggests an unpublished product', async () => {
    const res = await suggest('draft');
    const data = (res.body as { data: Suggestions }).data;

    expect(data.products).toEqual([]);
    expect(data.totalProducts).toBe(0);
  });

  it('suggests public categories by name, with the parent for a child', async () => {
    const res = await suggest('boot');
    const { categories } = (res.body as { data: Suggestions }).data;

    expect(categories).toEqual([{ slug: 'suggest-boots', name: 'Boots', parentName: 'Footwear' }]);
  });

  it('requires every word to match a category name', async () => {
    const res = await suggest('foot boot');

    expect((res.body as { data: Suggestions }).data.categories).toEqual([]);
  });

  it('keeps private fields out of the response', async () => {
    const res = await suggest('boot');
    const keys = allKeys(res.body);

    for (const field of PRIVATE_FIELDS) {
      expect(keys.has(field)).toBe(false);
    }
  });

  it.each([
    ['too short', { q: 'b' }],
    ['missing', {}],
    ['too long', { q: 'x'.repeat(101) }],
    ['carrying an unknown key', { q: 'boot', sort: 'newest' }],
  ])('rejects a query that is %s', async (_label, query) => {
    const res = await request(app).get(SUGGEST).query(query);

    expect(res.status).toBe(400);
  });

  it('treats LIKE wildcards as literal characters', async () => {
    const res = await suggest('%_');

    expect(res.status).toBe(200);
    expect((res.body as { data: Suggestions }).data.totalProducts).toBe(0);
  });

  it('counts requests against its own allowance', async () => {
    const limited = createTestApp({ suggestions: { windowMs: 60_000, limit: 2 } });
    const send = () => request(limited).get(SUGGEST).query({ q: 'boot' });

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);

    const refused = await send();
    expect(refused.status).toBe(429);
    expect((refused.body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });
});
