import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import { PRIVATE_FIELDS, allKeys, makeCategory, makeProduct } from './catalog-fixtures.js';
import { API, createTestApp, truncateAll } from './harness.js';

/**
 * `GET /products/arrivals` and the CUTOUT image kind (ADR 0017): the rail lists public products
 * that have a cut-out, newest first, and a cut-out never leaks into the card, the gallery, the
 * cart or the publication rule.
 */
const app = createTestApp();

const slugs: Record<string, string> = {};

beforeAll(async () => {
  await truncateAll();
  const jackets = await makeCategory('jackets', { name: 'Jackets' });
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  const make = async (key: string, spec: Omit<Parameters<typeof makeProduct>[0], 'categoryId'>) => {
    slugs[key] = (
      await makeProduct({ categoryId: jackets.id, name: `${key} jacket`, ...spec })
    ).product.slug;
  };

  await make('older', { cutout: true, publishedAt: minutesAgo(30) });
  await make('newest', { cutout: true, publishedAt: minutesAgo(5) });
  await make('middle', { cutout: true, publishedAt: minutesAgo(10) });
  await make('noCutout', { publishedAt: minutesAgo(1) });
  await make('draftWithCutout', { cutout: true, status: 'DRAFT' });
  await make('cutoutOnly', { cutout: true, images: 0, publishedAt: minutesAgo(2) });
});

afterAll(async () => {
  await prisma.$disconnect();
});

type Arrival = { slug: string; image: { url: string }; cutout: { url: string; alt: string } };

describe('GET /products/arrivals', () => {
  it('lists public products with a cut-out, newest first', async () => {
    const res = await request(app).get(`${API}/products/arrivals`);

    expect(res.status).toBe(200);
    const items = res.body.data as Arrival[];
    expect(items.map((item) => item.slug)).toEqual([slugs.newest, slugs.middle, slugs.older]);
    for (const item of items) {
      expect(item.cutout.url).toMatch(/\/media\/catalog\/test\/[^/]+\/cutout\.webp$/);
      expect(item.cutout.alt).toMatch(/cut-out$/);
      // The card image stays the photo, even though the cut-out sorts first and is older.
      expect(item.image.url).toMatch(/\/1\.jpg$/);
    }
  });

  it('honours limit and validates it', async () => {
    const one = await request(app).get(`${API}/products/arrivals`).query({ limit: 1 });
    expect((one.body.data as Arrival[]).map((item) => item.slug)).toEqual([slugs.newest]);

    for (const query of [{ limit: 0 }, { limit: 13 }, { limit: 'many' }, { sort: 'newest' }]) {
      const res = await request(app).get(`${API}/products/arrivals`).query(query);
      expect(res.status, JSON.stringify(query)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('never returns stock, provenance or storage keys', async () => {
    const res = await request(app).get(`${API}/products/arrivals`);
    const keys = allKeys(res.body.data);
    for (const field of PRIVATE_FIELDS) {
      expect(keys.has(field), `${field} leaked`).toBe(false);
    }
  });
});

describe('a cut-out is not a photo', () => {
  it('keeps the cut-out out of the product gallery', async () => {
    const res = await request(app).get(`${API}/products/${slugs.newest ?? ''}`);

    expect(res.status).toBe(200);
    const urls = (res.body.data.images as { url: string }[]).map((image) => image.url);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/1\.jpg$/);
  });

  it('does not satisfy the publication rule on its own', async () => {
    const detail = await request(app).get(`${API}/products/${slugs.cutoutOnly ?? ''}`);
    const listing = await request(app).get(`${API}/products`);

    expect(detail.status).toBe(404);
    expect((listing.body.data as { slug: string }[]).map((item) => item.slug)).not.toContain(
      slugs.cutoutOnly,
    );
  });
});
