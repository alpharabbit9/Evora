import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import { MAX_WISHLIST_ITEMS } from '../../src/modules/wishlist/wishlist.schemas.js';
import { PRIVATE_FIELDS, allKeys, makeCategory, makeProduct } from './catalog-fixtures.js';
import { API, ORIGIN, type TestSession, createTestApp, signUp, truncateAll } from './harness.js';

interface WishlistBody {
  data: { count: number; items: { savedAt: string; product: { id: string; slug: string } }[] };
}

const savedIds = (res: { body: unknown }) =>
  (res.body as WishlistBody).data.items.map((item) => item.product.id);

/**
 * The wishlist against a real database and the real session machinery (ADR 0016): account-only
 * access, per-account ownership, idempotent save and remove (including concurrent saves), the
 * publication rule on what can be saved and what is listed, and the per-account cap.
 */
const app = createTestApp();
const WISHLIST = `${API}/me/wishlist`;

let categoryId: string;
let coat: { id: string; slug: string };
let boots: { id: string };
let scarf: { id: string };
let draftId: string;
let shopper: TestSession;

beforeAll(async () => {
  await truncateAll();
  categoryId = (await makeCategory('outerwear')).id;

  const made = await makeProduct({ categoryId, name: 'Charcoal Wool Coat' });
  coat = { id: made.product.id, slug: made.product.slug };
  boots = { id: (await makeProduct({ categoryId })).product.id };
  scarf = { id: (await makeProduct({ categoryId })).product.id };
  draftId = (await makeProduct({ categoryId, status: 'DRAFT' })).product.id;
  shopper = await signUp(app);
});

beforeEach(async () => {
  await prisma.wishlistItem.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

function save(session: TestSession, productId: string) {
  return request(app)
    .put(`${WISHLIST}/items/${productId}`)
    .set('origin', ORIGIN)
    .set('cookie', session.cookie);
}

function remove(session: TestSession, productId: string) {
  return request(app)
    .delete(`${WISHLIST}/items/${productId}`)
    .set('origin', ORIGIN)
    .set('cookie', session.cookie);
}

describe('access', () => {
  it('refuses every wishlist endpoint without a session', async () => {
    await prisma.wishlistItem.create({ data: { userId: shopper.userId, productId: coat.id } });

    const responses = await Promise.all([
      request(app).get(WISHLIST),
      request(app).put(`${WISHLIST}/items/${boots.id}`).set('origin', ORIGIN),
      request(app).delete(`${WISHLIST}/items/${coat.id}`).set('origin', ORIGIN),
    ]);

    expect(responses.map((res) => res.status)).toEqual([401, 401, 401]);
    for (const res of responses) {
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    expect(await prisma.wishlistItem.count()).toBe(1);
  });

  it('refuses a write from an untrusted origin', async () => {
    const res = await request(app)
      .put(`${WISHLIST}/items/${coat.id}`)
      .set('origin', 'https://evil.example')
      .set('cookie', shopper.cookie);

    expect(res.status).toBe(403);
    expect(await prisma.wishlistItem.count()).toBe(0);
  });

  it('refuses a malformed product id', async () => {
    const res = await save(shopper, 'not%20an%20id');

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('saving and listing', () => {
  it('starts empty', async () => {
    const res = await request(app).get(WISHLIST).set('cookie', shopper.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ items: [], count: 0 });
  });

  it('saves a product and lists it as a catalog card, newest first', async () => {
    await save(shopper, coat.id);
    const res = await save(shopper, boots.id);

    expect(res.status).toBe(200);
    expect(savedIds(res)).toEqual([boots.id, coat.id]);
    expect(res.body.data.count).toBe(2);
    expect(res.body.data.items[1]).toMatchObject({
      savedAt: expect.any(String) as string,
      product: {
        id: coat.id,
        slug: coat.slug,
        name: 'Charcoal Wool Coat',
        currency: 'BDT',
        priceMinor: 250_000,
        inStock: true,
      },
    });
  });

  it('does not expose stock, price provenance or owner fields', async () => {
    const res = await save(shopper, coat.id);
    const keys = allKeys(res.body.data);

    for (const field of [...PRIVATE_FIELDS, 'userId', 'objectKey']) {
      expect(keys.has(field), `${field} leaked`).toBe(false);
    }
  });

  it('is idempotent: saving twice, or three times at once, leaves one row', async () => {
    await save(shopper, coat.id);
    const again = await save(shopper, coat.id);
    const racing = await Promise.all([
      save(shopper, boots.id),
      save(shopper, boots.id),
      save(shopper, boots.id),
    ]);

    expect(again.status).toBe(200);
    expect(racing.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(await prisma.wishlistItem.count({ where: { productId: coat.id } })).toBe(1);
    expect(await prisma.wishlistItem.count({ where: { productId: boots.id } })).toBe(1);
  });

  it.each([
    ['an unpublished product', () => draftId],
    ['a product id that does not exist', () => 'cmnotarealproduct000000'],
  ])('answers 404 for %s and saves nothing', async (_label, productId) => {
    const res = await save(shopper, productId());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(await prisma.wishlistItem.count()).toBe(0);
  });

  it('hides a saved product once it is taken down, and shows it again if it returns', async () => {
    await save(shopper, coat.id);
    await save(shopper, scarf.id);

    await prisma.product.update({ where: { id: scarf.id }, data: { status: 'ARCHIVED' } });
    const hidden = await request(app).get(WISHLIST).set('cookie', shopper.cookie);
    expect(savedIds(hidden)).toEqual([coat.id]);
    expect(hidden.body.data.count).toBe(1);

    await prisma.product.update({ where: { id: scarf.id }, data: { status: 'PUBLISHED' } });
    const back = await request(app).get(WISHLIST).set('cookie', shopper.cookie);
    expect(savedIds(back)).toEqual([scarf.id, coat.id]);
  });
});

describe('removing', () => {
  it('removes a saved product, and removing it again is not an error', async () => {
    await save(shopper, coat.id);
    await save(shopper, boots.id);

    const first = await remove(shopper, coat.id);
    const second = await remove(shopper, coat.id);

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(savedIds(second)).toEqual([boots.id]);
  });
});

describe('ownership', () => {
  it("keeps each account's list to itself", async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);
    await save(alice, coat.id);

    const bobsView = await request(app).get(WISHLIST).set('cookie', bob.cookie);
    const bobsRemove = await remove(bob, coat.id);
    const alicesView = await request(app).get(WISHLIST).set('cookie', alice.cookie);

    expect(bobsView.body.data.items).toEqual([]);
    expect(bobsRemove.status).toBe(200);
    expect(savedIds(alicesView)).toEqual([coat.id]);
  });
});

describe('limits', () => {
  it(`refuses a new save at ${String(MAX_WISHLIST_ITEMS)} pieces but still accepts a repeat`, async () => {
    const user = await signUp(app);
    await save(user, coat.id);

    // Fill the rest with hidden products, written directly: the cap counts every saved row.
    const fillers = Array.from({ length: MAX_WISHLIST_ITEMS - 1 }, () => {
      const suffix = randomUUID().slice(0, 12);
      return { name: `Filler ${suffix}`, slug: `filler-${suffix}`, categoryId };
    });
    await prisma.product.createMany({ data: fillers });
    const fillerIds = await prisma.product.findMany({
      where: { slug: { in: fillers.map((filler) => filler.slug) } },
      select: { id: true },
    });
    await prisma.wishlistItem.createMany({
      data: fillerIds.map(({ id }) => ({ userId: user.userId, productId: id })),
    });

    const repeat = await save(user, coat.id);
    const another = await save(user, boots.id);

    expect(repeat.status).toBe(200);
    expect(another.status).toBe(409);
    expect(another.body.error.code).toBe('CONFLICT');
    expect(await prisma.wishlistItem.count({ where: { userId: user.userId } })).toBe(
      MAX_WISHLIST_ITEMS,
    );
  });
});
