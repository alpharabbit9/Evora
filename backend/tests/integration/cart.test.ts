import { randomBytes } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import {
  GUEST_CART_COOKIE,
  GUEST_CART_TTL_MS,
  hashGuestToken,
} from '../../src/modules/cart/guest-token.js';
import { allKeys, makeCategory, makeProduct } from './catalog-fixtures.js';
import { API, ORIGIN, type TestSession, createTestApp, signUp, truncateAll } from './harness.js';

interface CartBody {
  data: { items: { id: string; status: string; quantity: number; variant: { id: string } }[] };
}

const linesOf = (res: { body: unknown }) => (res.body as CartBody).data.items;

/**
 * The cart against a real database and the real session machinery: account-only access
 * (ADR 0014), server-side pricing and stock checks, account ownership, the merge of a guest
 * cart left over from before ADR 0014, and the concurrency cases (two adds of the same item,
 * two merges at once).
 */
const app = createTestApp();
const CART = `${API}/cart`;

let categoryId: string;
let shirt: { variantId: string; slug: string };
let roomy: { variantId: string };
let soldOut: { variantId: string };
let draftVariantId: string;
let noImageVariantId: string;
let shopper: TestSession;

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
  shopper = await signUp(app);
});

beforeEach(async () => {
  await prisma.cartItem.deleteMany();
  await prisma.cart.deleteMany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

/** Adds to the signed-in account's cart, from the trusted origin as a browser would. */
function addAs(session: TestSession, variantId: string, quantity = 1) {
  return request(app)
    .post(`${CART}/items`)
    .set('origin', ORIGIN)
    .set('cookie', session.cookie)
    .send({ variantId, quantity });
}

/**
 * A guest cart made before ADR 0014, written directly because the API no longer creates one.
 * Returns the cookie the browser that made it would still be carrying.
 */
async function legacyGuestCart(
  lines: { variantId: string; quantity: number }[],
  expiresAt = new Date(Date.now() + GUEST_CART_TTL_MS),
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await prisma.cart.create({
    data: { guestTokenHash: hashGuestToken(token), expiresAt, items: { create: lines } },
  });
  return `${GUEST_CART_COOKIE}=${token}`;
}

describe('access', () => {
  it('refuses every cart endpoint without a session, even with a guest cart cookie', async () => {
    const guestCookie = await legacyGuestCart([{ variantId: roomy.variantId, quantity: 1 }]);
    const lineId = (await prisma.cartItem.findFirstOrThrow()).id;

    const responses = await Promise.all([
      request(app).get(CART).set('cookie', guestCookie),
      request(app)
        .post(`${CART}/items`)
        .set('origin', ORIGIN)
        .set('cookie', guestCookie)
        .send({ variantId: shirt.variantId, quantity: 1 }),
      request(app)
        .patch(`${CART}/items/${lineId}`)
        .set('origin', ORIGIN)
        .set('cookie', guestCookie)
        .send({ quantity: 3 }),
      request(app)
        .delete(`${CART}/items/${lineId}`)
        .set('origin', ORIGIN)
        .set('cookie', guestCookie),
    ]);

    expect(responses.map((res) => res.status)).toEqual([401, 401, 401, 401]);
    for (const res of responses) {
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
    // Nothing was created, changed or removed, and no cookie was issued.
    expect(responses.some((res) => res.headers['set-cookie'] !== undefined)).toBe(false);
    expect(await prisma.cart.count()).toBe(1);
    expect((await prisma.cartItem.findUniqueOrThrow({ where: { id: lineId } })).quantity).toBe(1);
  });

  it('refuses a write from an untrusted origin', async () => {
    const res = await request(app)
      .post(`${CART}/items`)
      .set('origin', 'https://evil.example')
      .set('cookie', shopper.cookie)
      .send({ variantId: shirt.variantId });

    expect(res.status).toBe(403);
    expect(await prisma.cart.count()).toBe(0);
  });
});

describe('adding items', () => {
  it("adds to the account's cart and prices it from the database", async () => {
    const res = await addAs(shopper, shirt.variantId, 2);

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

    // Owned by the account, with no guest credential.
    expect(res.headers['set-cookie']).toBeUndefined();
    const cart = await prisma.cart.findFirstOrThrow();
    expect(cart.userId).toBe(shopper.userId);
    expect(cart.guestTokenHash).toBeNull();
  });

  it('refuses a client-supplied price instead of ignoring it', async () => {
    const res = await request(app)
      .post(`${CART}/items`)
      .set('origin', ORIGIN)
      .set('cookie', shopper.cookie)
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
    const res = await addAs(shopper, variantId());

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('refuses a sold-out variant with OUT_OF_STOCK', async () => {
    const res = await addAs(shopper, soldOut.variantId);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
  });

  it('refuses more than is in stock and leaves the line as it was', async () => {
    await addAs(shopper, shirt.variantId, 4);
    const second = await addAs(shopper, shirt.variantId, 2);

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('OUT_OF_STOCK');

    const cart = await request(app).get(CART).set('cookie', shopper.cookie);
    expect(cart.body.data.items[0].quantity).toBe(4);
  });

  it('caps a line at 10 and rolls the increment back', async () => {
    const first = await addAs(shopper, roomy.variantId, 10);
    const second = await addAs(shopper, roomy.variantId, 1);

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);

    const line = await prisma.cartItem.findFirstOrThrow();
    expect(line.quantity).toBe(10);
  });

  it('counts both of two concurrent adds of the same item', async () => {
    const user = await signUp(app);

    const results = await Promise.all([
      addAs(user, roomy.variantId),
      addAs(user, roomy.variantId),
      addAs(user, roomy.variantId),
    ]);

    expect(results.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(await prisma.cart.count({ where: { userId: user.userId } })).toBe(1);
    expect((await prisma.cartItem.findFirstOrThrow()).quantity).toBe(3);
  });
});

describe('reading and ownership', () => {
  it('returns an empty cart without creating one', async () => {
    const res = await request(app).get(CART).set('cookie', shopper.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: null, items: [], itemCount: 0, subtotalMinor: 0 });
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(await prisma.cart.count()).toBe(0);
  });

  it('does not expose stock, price provenance or owner fields', async () => {
    const res = await addAs(shopper, shirt.variantId);
    const keys = allKeys(res.body.data);

    for (const field of ['stockQuantity', 'priceSource', 'guestTokenHash', 'userId', 'objectKey']) {
      expect(keys.has(field), `${field} leaked`).toBe(false);
    }
  });

  it("does not let one account read or change another account's line", async () => {
    const alice = await signUp(app);
    const bob = await signUp(app);

    const added = await addAs(alice, shirt.variantId);
    const lineId = added.body.data.items[0].id as string;

    const bobsView = await request(app).get(CART).set('cookie', bob.cookie);
    const bobsPatch = await request(app)
      .patch(`${CART}/items/${lineId}`)
      .set('origin', ORIGIN)
      .set('cookie', bob.cookie)
      .send({ quantity: 2 });
    const bobsDelete = await request(app)
      .delete(`${CART}/items/${lineId}`)
      .set('origin', ORIGIN)
      .set('cookie', bob.cookie);

    expect(bobsView.body.data.items).toEqual([]);
    expect([bobsPatch.status, bobsDelete.status]).toEqual([404, 404]);
    expect((await prisma.cartItem.findUniqueOrThrow({ where: { id: lineId } })).quantity).toBe(1);
  });
});

describe('updating and line status', () => {
  it('marks lines that can no longer be bought and leaves them out of the subtotal', async () => {
    const { cookie } = shopper;
    await addAs(shopper, shirt.variantId, 3);
    await addAs(shopper, roomy.variantId, 1);

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
      .set('origin', ORIGIN)
      .set('cookie', cookie)
      .send({ quantity: 3 + 1 });
    expect(raise.status).toBe(409);
    const lower = await request(app)
      .patch(`${CART}/items/${lineId}`)
      .set('origin', ORIGIN)
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
    const res = await addAs(shopper, shirt.variantId);
    const lineId = res.body.data.items[0].id as string;

    const del = await request(app)
      .delete(`${CART}/items/${lineId}`)
      .set('origin', ORIGIN)
      .set('cookie', shopper.cookie);

    expect(del.status).toBe(200);
    expect(del.body.data.items).toEqual([]);
  });
});

describe('price changes since a line was added', () => {
  /** Each case gets its own variant, so a price change cannot leak into another test. */
  async function freshVariant(priceMinor: number): Promise<string> {
    const made = await makeProduct({ categoryId, variants: [{ priceMinor, stockQuantity: 20 }] });
    return made.variants[0]?.id ?? '';
  }

  function setPrice(variantId: string, priceMinor: number) {
    return prisma.productVariant.update({ where: { id: variantId }, data: { priceMinor } });
  }

  function priceLine(res: { body: unknown }) {
    return (
      res.body as {
        data: {
          items: { id: string; unitPriceMinor: number; previousUnitPriceMinor: number | null }[];
        };
      }
    ).data.items[0];
  }

  it('shows no notice while the price is the one the customer saw', async () => {
    const variantId = await freshVariant(100_000);

    const res = await addAs(shopper, variantId);

    expect(priceLine(res)?.previousUnitPriceMinor).toBeNull();
  });

  it('reports the price the customer saw when the catalog price changes, either way', async () => {
    const up = await freshVariant(100_000);
    const down = await freshVariant(200_000);
    await addAs(shopper, up);
    await addAs(shopper, down);
    await setPrice(up, 120_000);
    await setPrice(down, 150_000);

    const cart = await request(app).get(CART).set('cookie', shopper.cookie);
    const lines = (cart.body as { data: { items: Record<string, unknown>[] } }).data.items;

    expect(lines.map((line) => [line.unitPriceMinor, line.previousUnitPriceMinor])).toEqual([
      [120_000, 100_000],
      [150_000, 200_000],
    ]);
    // The current price is still what the bag charges.
    expect((cart.body as { data: { subtotalMinor: number } }).data.subtotalMinor).toBe(270_000);
  });

  it('clears the notice once the customer changes the line or adds it again', async () => {
    const changed = await freshVariant(100_000);
    const readded = await freshVariant(100_000);
    const first = await addAs(shopper, changed);
    await addAs(shopper, readded);
    await setPrice(changed, 130_000);
    await setPrice(readded, 130_000);

    const lineId = priceLine(first)?.id ?? '';
    await request(app)
      .patch(`${CART}/items/${lineId}`)
      .set('origin', ORIGIN)
      .set('cookie', shopper.cookie)
      .send({ quantity: 2 });
    const again = await addAs(shopper, readded);

    const lines = (again.body as { data: { items: { previousUnitPriceMinor: unknown }[] } }).data
      .items;
    expect(lines.map((line) => line.previousUnitPriceMinor)).toEqual([null, null]);
  });

  it('shows no notice for a line with no remembered price', async () => {
    const variantId = await freshVariant(100_000);
    await addAs(shopper, variantId);
    await prisma.cartItem.updateMany({ data: { unitPriceSeenMinor: null } });
    await setPrice(variantId, 90_000);

    const cart = await request(app).get(CART).set('cookie', shopper.cookie);

    expect(priceLine(cart)?.previousUnitPriceMinor).toBeNull();
  });
});

describe('merging a guest cart left from before ADR 0014', () => {
  it('folds the guest bag into the account on the next cart request, capped per line', async () => {
    const user = await signUp(app);
    await addAs(user, roomy.variantId, 9);

    const guestCookie = await legacyGuestCart([
      { variantId: roomy.variantId, quantity: 3 },
      { variantId: shirt.variantId, quantity: 1 },
    ]);

    const merged = await request(app).get(CART).set('cookie', `${user.cookie}; ${guestCookie}`);

    expect(merged.status).toBe(200);
    const quantities = Object.fromEntries(
      linesOf(merged).map((item) => [item.variant.id, item.quantity]),
    );
    expect(quantities).toEqual({ [roomy.variantId]: 10, [shirt.variantId]: 1 });
    expect(String(merged.headers['set-cookie'])).toMatch(/commercecore\.cart=;/);
    expect(await prisma.cart.count({ where: { guestTokenHash: { not: null } } })).toBe(0);

    // A stale guest cookie on a later request changes nothing.
    const again = await request(app).get(CART).set('cookie', `${user.cookie}; ${guestCookie}`);
    expect(again.body.data.itemCount).toBe(11);
  });

  it('merges once when two requests race with the same guest cookie', async () => {
    const user = await signUp(app);
    const guestCookie = await legacyGuestCart([{ variantId: roomy.variantId, quantity: 2 }]);
    const both = `${user.cookie}; ${guestCookie}`;

    await Promise.all([
      request(app).get(CART).set('cookie', both),
      request(app).get(CART).set('cookie', both),
      request(app).get(CART).set('cookie', both),
    ]);

    const cart = await request(app).get(CART).set('cookie', user.cookie);
    expect(cart.body.data.items).toHaveLength(1);
    expect(cart.body.data.items[0].quantity).toBe(2);
  });

  it('does not merge a guest cart that has expired', async () => {
    const user = await signUp(app);
    const guestCookie = await legacyGuestCart(
      [{ variantId: roomy.variantId, quantity: 2 }],
      new Date(Date.now() - 1000),
    );

    const cart = await request(app).get(CART).set('cookie', `${user.cookie}; ${guestCookie}`);

    expect(cart.status).toBe(200);
    expect(cart.body.data.items).toEqual([]);
  });
});
