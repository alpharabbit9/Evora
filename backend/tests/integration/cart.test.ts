import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import { GUEST_CART_COOKIE } from '../../src/modules/cart/guest-token.js';
import { allKeys, makeCategory, makeProduct } from './catalog-fixtures.js';
import { API, ORIGIN, cookieFrom, createTestApp, signUp, truncateAll } from './harness.js';

interface CartBody {
  data: { items: { id: string; status: string; quantity: number; variant: { id: string } }[] };
}

const linesOf = (res: { body: unknown }) => (res.body as CartBody).data.items;

/**
 * The cart against a real database and the real session machinery: server-side pricing and
 * stock checks, guest-token and account ownership, the guest-to-account merge, and the
 * concurrency cases (two adds of the same item, two merges at once).
 */
const app = createTestApp();
const CART = `${API}/cart`;

let categoryId: string;
let shirt: { variantId: string; slug: string };
let roomy: { variantId: string };
let soldOut: { variantId: string };
let draftVariantId: string;
let noImageVariantId: string;

beforeAll(async () => {
  await truncateAll();
  categoryId = (await makeCategory('shirts')).id;

  const made = await makeProduct({
    categoryId,
    name: 'Black Oxford Shirt',
    variants: [{ size: 'M', priceMinor: 275_000, stockQuantity: 5 }],
  });
  shirt = { variantId: made.variants[0]?.id ?? '', slug: made.product.slug };
  roomy = {
    variantId:
      (await makeProduct({ categoryId, variants: [{ priceMinor: 120_000, stockQuantity: 50 }] }))
        .variants[0]?.id ?? '',
  };
  soldOut = {
    variantId:
      (await makeProduct({ categoryId, variants: [{ stockQuantity: 0 }] })).variants[0]?.id ?? '',
  };
  draftVariantId = (await makeProduct({ categoryId, status: 'DRAFT' })).variants[0]?.id ?? '';
  noImageVariantId = (await makeProduct({ categoryId, images: 0 })).variants[0]?.id ?? '';
});

beforeEach(async () => {
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Adds as a guest and returns the guest cookie the API set (or the one passed in). */
async function guestAdd(variantId: string, quantity = 1, cookie?: string) {
  const req = request(app).post(`${CART}/items`).set('origin', ORIGIN);
  if (cookie) req.set('cookie', cookie);
  const res = await req.send({ variantId, quantity });
  return { res, cookie: cookieFrom(res.headers) || cookie || '' };
}

describe('adding items', () => {
  it('creates a guest cart behind an httpOnly cookie and prices it from the database', async () => {
    const { res } = await guestAdd(shirt.variantId, 2);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      currency: 'BDT',
      itemCount: 2,
      subtotalMinor: 550_000,
      hasIssues: false,
      items: [
        {
          quantity: 2,
          status: 'available',
          unitPriceMinor: 275_000,
          lineTotalMinor: 550_000,
          variant: { id: shirt.variantId, size: 'M', color: 'Black' },
          product: { slug: shirt.slug, name: 'Black Oxford Shirt' },
        },
      ],
    });

    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain(`${GUEST_CART_COOKIE}=`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toContain('Path=/api/v1/cart');

    // Only the hash is stored.
    const token = /commercecore\.cart=([^;]+)/.exec(setCookie)?.[1] ?? '';
    const cart = await prisma.cart.findFirstOrThrow();
    expect(cart.guestTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(cart.guestTokenHash).not.toBe(token);
  });

  it('refuses a client-supplied price instead of ignoring it', async () => {
    const res = await request(app)
      .post(`${CART}/items`)
      .send({ variantId: shirt.variantId, quantity: 1, priceMinor: 1 });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await prisma.cart.count()).toBe(0);
  });

  it.each([
    ['an unpublished product', () => draftVariantId],
    ['a product without an image', () => noImageVariantId],
    ['a variant id that does not exist', () => 'cmnotarealvariant000000'],
  ])('answers 404 for %s', async (_label, variantId) => {
    const { res } = await guestAdd(variantId());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses a sold-out variant with OUT_OF_STOCK', async () => {
    const { res } = await guestAdd(soldOut.variantId);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
  });

  it('refuses more than is in stock and leaves the line as it was', async () => {
    const first = await guestAdd(shirt.variantId, 4);
    const second = await guestAdd(shirt.variantId, 2, first.cookie);

    expect(second.res.status).toBe(409);
    expect(second.res.body.error.code).toBe('OUT_OF_STOCK');

    const cart = await request(app).get(CART).set('cookie', first.cookie);
    expect(cart.body.data.items[0].quantity).toBe(4);
  });

  it('caps a line at 10 and rolls the increment back', async () => {
    const first = await guestAdd(roomy.variantId, 10);
    const second = await guestAdd(roomy.variantId, 1, first.cookie);

    expect(first.res.status).toBe(200);
    expect(second.res.status).toBe(400);

    const line = await prisma.cartItem.findFirstOrThrow();
    expect(line.quantity).toBe(10);
  });

  it('counts both of two concurrent adds of the same item', async () => {
    const user = await signUp(app);
    const add = () =>
      request(app)
        .post(`${CART}/items`)
        .set('origin', ORIGIN)
        .set('cookie', user.cookie)
        .send({ variantId: roomy.variantId, quantity: 1 });

    const results = await Promise.all([add(), add(), add()]);

    expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(await prisma.cart.count({ where: { userId: user.userId } })).toBe(1);
    expect((await prisma.cartItem.findFirstOrThrow()).quantity).toBe(3);
  });

  it('refuses a write from an untrusted origin', async () => {
    const res = await request(app)
      .post(`${CART}/items`)
      .set('origin', 'https://evil.example')
      .send({ variantId: shirt.variantId });

    expect(res.status).toBe(403);
    expect(await prisma.cart.count()).toBe(0);
  });
});

describe('reading and ownership', () => {
  it('returns an empty cart without creating one', async () => {
    const res = await request(app).get(CART);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: null, items: [], itemCount: 0, subtotalMinor: 0 });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.cart.count()).toBe(0);
  });

  it('does not expose stock, price provenance or owner fields', async () => {
    const { res } = await guestAdd(shirt.variantId);
    const keys = allKeys(res.body.data);

    for (const field of ['stockQuantity', 'priceSource', 'guestTokenHash', 'userId', 'objectKey']) {
      expect(keys.has(field), `${field} leaked`).toBe(false);
    }
  });

  it("does not let one guest read or change another guest's line", async () => {
    const owner = await guestAdd(shirt.variantId);
    const lineId = owner.res.body.data.items[0].id as string;
    const intruder = await guestAdd(roomy.variantId);

    const patch = await request(app)
      .patch(`${CART}/items/${lineId}`)
      .set('cookie', intruder.cookie)
      .send({ quantity: 3 });
    const del = await request(app).delete(`${CART}/items/${lineId}`).set('cookie', intruder.cookie);
    const anonymous = await request(app).delete(`${CART}/items/${lineId}`);

    expect([patch.status, del.status, anonymous.status]).toEqual([404, 404, 404]);
    expect((await prisma.cartItem.findUniqueOrThrow({ where: { id: lineId } })).quantity).toBe(1);
  });

  it("does not let one account change another account's line", async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);

    const added = await request(app)
      .post(`${CART}/items`)
      .set('origin', ORIGIN)
      .set('cookie', alice.cookie)
      .send({ variantId: shirt.variantId });
    const lineId = added.body.data.items[0].id as string;

    const bobsView = await request(app).get(CART).set('cookie', bob.cookie);
    const bobsPatch = await request(app)
      .patch(`${CART}/items/${lineId}`)
      .set('origin', ORIGIN)
      .set('cookie', bob.cookie)
      .send({ quantity: 2 });

    expect(bobsView.body.data.items).toEqual([]);
    expect(bobsPatch.status).toBe(404);
  });

  it('ignores an expired guest cart and starts a new one on the next add', async () => {
    const first = await guestAdd(shirt.variantId);
    await prisma.cart.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

    const read = await request(app).get(CART).set('cookie', first.cookie);
    expect(read.body.data.items).toEqual([]);

    const again = await guestAdd(roomy.variantId, 1, first.cookie);
    expect(again.res.status).toBe(200);
    expect(again.cookie).not.toBe(first.cookie);
    expect(again.res.body.data.items).toHaveLength(1);
  });
});

describe('updating and line status', () => {
  it('marks lines that can no longer be bought and leaves them out of the subtotal', async () => {
    const { cookie } = await guestAdd(shirt.variantId, 3);
    await guestAdd(roomy.variantId, 1, cookie);

    // Stock falls below the line's quantity.
    await prisma.productVariant.update({
      where: { id: shirt.variantId },
      data: { stockQuantity: 2 },
    });
    let cart = await request(app).get(CART).set('cookie', cookie);
    expect(linesOf(cart).map((item) => item.status)).toEqual(['insufficient_stock', 'available']);
    expect(cart.body.data).toMatchObject({ hasIssues: true, subtotalMinor: 120_000, itemCount: 4 });

    // Raising is refused, lowering resolves it.
    const lineId = cart.body.data.items[0].id as string;
    const raise = await request(app)
      .patch(`${CART}/items/${lineId}`)
      .set('cookie', cookie)
      .send({ quantity: 3 + 1 });
    expect(raise.status).toBe(409);
    const lower = await request(app)
      .patch(`${CART}/items/${lineId}`)
      .set('cookie', cookie)
      .send({ quantity: 2 });
    expect(lower.status).toBe(200);
    expect(lower.body.data.hasIssues).toBe(false);

    // The product is unpublished.
    const product = await prisma.productVariant.findUniqueOrThrow({
      where: { id: shirt.variantId },
      select: { productId: true },
    });
    await prisma.product.update({ where: { id: product.productId }, data: { status: 'DRAFT' } });
    cart = await request(app).get(CART).set('cookie', cookie);
    expect(cart.body.data.items[0].status).toBe('unavailable');
    expect(cart.body.data.subtotalMinor).toBe(120_000);

    // Restore for the other tests.
    await prisma.product.update({
      where: { id: product.productId },
      data: { status: 'PUBLISHED' },
    });
    await prisma.productVariant.update({
      where: { id: shirt.variantId },
      data: { stockQuantity: 5 },
    });
  });

  it('removes a line', async () => {
    const { res, cookie } = await guestAdd(shirt.variantId);
    const lineId = res.body.data.items[0].id as string;

    const del = await request(app).delete(`${CART}/items/${lineId}`).set('cookie', cookie);

    expect(del.status).toBe(200);
    expect(del.body.data.items).toEqual([]);
  });
});

describe('guest to account merge', () => {
  it('folds the guest bag into the account on the next cart request, capped per line', async () => {
    const user = await signUp(app);
    await request(app)
      .post(`${CART}/items`)
      .set('origin', ORIGIN)
      .set('cookie', user.cookie)
      .send({ variantId: roomy.variantId, quantity: 9 });

    const guest = await guestAdd(roomy.variantId, 3);
    await guestAdd(shirt.variantId, 1, guest.cookie);

    const merged = await request(app).get(CART).set('cookie', `${user.cookie}; ${guest.cookie}`);

    expect(merged.status).toBe(200);
    const quantities = Object.fromEntries(
      linesOf(merged).map((item) => [item.variant.id, item.quantity]),
    );
    expect(quantities).toEqual({ [roomy.variantId]: 10, [shirt.variantId]: 1 });
    expect(String(merged.headers['set-cookie'])).toMatch(/commercecore\.cart=;/);
    expect(await prisma.cart.count({ where: { guestTokenHash: { not: null } } })).toBe(0);

    // A stale guest cookie on a later request changes nothing.
    const again = await request(app).get(CART).set('cookie', `${user.cookie}; ${guest.cookie}`);
    expect(again.body.data.itemCount).toBe(11);
  });

  it('merges once when two requests race with the same guest cookie', async () => {
    const user = await signUp(app);
    const guest = await guestAdd(roomy.variantId, 2);
    const both = `${user.cookie}; ${guest.cookie}`;

    await Promise.all([
      request(app).get(CART).set('cookie', both),
      request(app).get(CART).set('cookie', both),
      request(app).get(CART).set('cookie', both),
    ]);

    const cart = await request(app).get(CART).set('cookie', user.cookie);
    expect(cart.body.data.items).toHaveLength(1);
    expect(cart.body.data.items[0].quantity).toBe(2);
  });
});
