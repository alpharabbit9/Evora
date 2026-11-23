import { randomUUID } from 'node:crypto';

import { UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import { deliveryFeeMinor } from '../../src/modules/pricing/pricing.js';
import { allKeys, makeCategory, makeProduct } from './catalog-fixtures.js';
import {
  API,
  ORIGIN,
  type TestSession,
  createTestApp,
  signUp,
  signUpAs,
  truncateAll,
} from './harness.js';

const app = createTestApp();
const CHECKOUT = `${API}/checkout`;

const STANDARD_DHAKA = deliveryFeeMinor('standard', { city: 'Dhaka', countryCode: 'BD' });
const STANDARD_OUTSIDE = deliveryFeeMinor('standard', { city: 'Sylhet', countryCode: 'BD' });

let customer: TestSession;
let categoryId: string;

beforeAll(async () => {
  await truncateAll();
  customer = await signUp(app);
  categoryId = (await makeCategory('checkout-shoes')).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.cartItem.deleteMany();
});

interface Shipping {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  countryCode: string;
}

const SHIPPING: Shipping = {
  recipientName: 'Test Person',
  phone: '+880 1700-000000',
  line1: '1 Test Road',
  city: 'Dhaka',
  postalCode: '1207',
  countryCode: 'BD',
};

async function makeVariant(
  spec: { priceMinor?: number; stockQuantity?: number; lowStockThreshold?: number } = {},
) {
  const { product, variants } = await makeProduct({
    categoryId,
    name: 'Checkout Shoe',
    variants: [
      {
        size: 'M',
        priceMinor: spec.priceMinor ?? 250_000,
        stockQuantity: spec.stockQuantity ?? 10,
        lowStockThreshold: spec.lowStockThreshold ?? 0,
      },
    ],
  });
  const variant = variants[0];

  if (!variant) {
    throw new Error('fixture has no variant');
  }

  return { product, variant };
}

function quote(body: object, session: TestSession = customer) {
  return request(app)
    .post(`${CHECKOUT}/quote`)
    .set('origin', ORIGIN)
    .set('cookie', session.cookie)
    .send(body);
}

function place(body: object, key: string = randomUUID(), session: TestSession = customer) {
  return request(app)
    .post(CHECKOUT)
    .set('origin', ORIGIN)
    .set('cookie', session.cookie)
    .set('idempotency-key', key)
    .send(body);
}

/** A valid order for one variant, totalled the way the store would total it. */
function orderBody(
  items: readonly { variantId: string; quantity: number; priceMinor: number }[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const subtotal = items.reduce((sum, item) => sum + item.priceMinor * item.quantity, 0);

  return {
    items: items.map(({ variantId, quantity }) => ({ variantId, quantity })),
    shipping: SHIPPING,
    deliveryOption: 'standard',
    paymentMethod: 'COD',
    expectedTotalMinor: subtotal + STANDARD_DHAKA,
    ...overrides,
  };
}

async function stockOf(variantId: string): Promise<number> {
  const row = await prisma.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { stockQuantity: true },
  });

  return row.stockQuantity;
}

async function counts(variantId: string) {
  const [orders, items, movements] = await Promise.all([
    prisma.order.count({ where: { items: { some: { variantId } } } }),
    prisma.orderItem.count({ where: { variantId } }),
    prisma.inventoryMovement.count({ where: { variantId } }),
  ]);

  return { orders, items, movements };
}

describe('access', () => {
  it('answers 401 without a session, on both endpoints', async () => {
    const { variant } = await makeVariant();
    const body = orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]);

    const quoted = await request(app)
      .post(`${CHECKOUT}/quote`)
      .set('origin', ORIGIN)
      .send({ items: body.items });
    const placed = await request(app)
      .post(CHECKOUT)
      .set('origin', ORIGIN)
      .set('idempotency-key', randomUUID())
      .send(body);

    expect(quoted.status).toBe(401);
    expect(placed.status).toBe(401);
    expect(await stockOf(variant.id)).toBe(10);
  });

  it('refuses a cross-site request carrying a valid session', async () => {
    const { variant } = await makeVariant();

    const res = await request(app)
      .post(CHECKOUT)
      .set('origin', 'https://evil.example')
      .set('cookie', customer.cookie)
      .set('idempotency-key', randomUUID())
      .send(orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]));

    expect(res.status).toBe(403);
    expect(await stockOf(variant.id)).toBe(10);
  });
});

describe('input validation', () => {
  const VARIANT_ID = 'cm000000000000000000000';

  it.each([
    ['a client unit price', { priceMinor: 1 }, 'item'],
    ['a client total', { totalMinor: 1 }, 'body'],
    ['a client shipping fee', { shippingMinor: 0 }, 'body'],
    ['a client discount', { discountMinor: 250_000 }, 'body'],
    // `couponCode` is accepted since M10 (ADR 0022); admin-completeness.test.ts covers it.
    ['a discount rate', { discountBps: 10_000 }, 'body'],
    ['a contact email', { contactEmail: 'stranger@example.test' }, 'body'],
  ])('rejects %s as an unknown field', async (_label, extra, where) => {
    const body = orderBody([{ variantId: VARIANT_ID, quantity: 1, priceMinor: 100 }]);

    const res = await place(
      where === 'item'
        ? { ...body, items: [{ variantId: VARIANT_ID, quantity: 1, ...extra }] }
        : { ...body, ...extra },
    );

    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['above the per-line cap', 11],
    ['fractional', 1.5],
  ])('rejects a %s quantity', async (_label, quantity) => {
    const res = await place(
      orderBody([{ variantId: VARIANT_ID, quantity: 1, priceMinor: 100 }], {
        items: [{ variantId: VARIANT_ID, quantity }],
      }),
    );

    expect(res.status).toBe(400);
  });

  it('rejects the same variant twice, an empty order and online payment', async () => {
    const base = orderBody([{ variantId: VARIANT_ID, quantity: 1, priceMinor: 100 }]);

    const twice = await place({
      ...base,
      items: [
        { variantId: VARIANT_ID, quantity: 1 },
        { variantId: VARIANT_ID, quantity: 1 },
      ],
    });
    const empty = await place({ ...base, items: [] });
    const unknownMethod = await place({ ...base, paymentMethod: 'CRYPTO' });

    expect(twice.status).toBe(400);
    expect(empty.status).toBe(400);
    expect(unknownMethod.status).toBe(400);
  });

  it('requires a well-formed Idempotency-Key', async () => {
    const { variant } = await makeVariant();
    const body = orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]);

    const missing = await request(app)
      .post(CHECKOUT)
      .set('origin', ORIGIN)
      .set('cookie', customer.cookie)
      .send(body);
    const tooShort = await place(body, 'short');

    expect(missing.status).toBe(400);
    expect(tooShort.status).toBe(400);
    expect(await stockOf(variant.id)).toBe(10);
  });

  it('refuses a country the store does not deliver to', async () => {
    const { variant } = await makeVariant();

    const res = await place(
      orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }], {
        shipping: { ...SHIPPING, countryCode: 'US' },
      }),
    );

    expect(res.status).toBe(400);
    expect(await stockOf(variant.id)).toBe(10);
  });

  it('rejects a missing address field and an unusable phone number', async () => {
    const { variant } = await makeVariant();
    const items = [{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }];

    const noPhone = await place(
      orderBody(items, {
        shipping: { recipientName: 'A', line1: 'B', city: 'C', postalCode: 'D', countryCode: 'BD' },
      }),
    );
    const badPhone = await place(orderBody(items, { shipping: { ...SHIPPING, phone: 'call me' } }));

    expect(noPhone.status).toBe(400);
    expect(badPhone.status).toBe(400);
  });
});

describe('POST /checkout/quote', () => {
  it('prices from the catalog, charges by destination, and writes nothing', async () => {
    const { variant } = await makeVariant({ priceMinor: 100_000 });
    const before = await counts(variant.id);

    const res = await quote({
      items: [{ variantId: variant.id, quantity: 2 }],
      destination: { city: 'Sylhet', countryCode: 'bd' },
    });

    expect(res.status).toBe(200);
    const { data } = res.body as {
      data: {
        subtotalMinor: number;
        shippingMinor: number;
        totalMinor: number;
        currency: string;
        hasIssues: boolean;
        paymentMethods: string[];
        items: { status: string; lineTotalMinor: number }[];
      };
    };
    expect(data.subtotalMinor).toBe(200_000);
    expect(data.shippingMinor).toBe(STANDARD_OUTSIDE);
    expect(data.totalMinor).toBe(200_000 + STANDARD_OUTSIDE);
    expect(data.currency).toBe('BDT');
    expect(data.paymentMethods).toEqual(['COD', 'ONLINE']);
    expect(data.hasIssues).toBe(false);
    expect(data.items[0]?.status).toBe('available');
    expect(await stockOf(variant.id)).toBe(10);
    expect(await counts(variant.id)).toEqual(before);
  });

  it('leaves the total open until a destination is known', async () => {
    const { variant } = await makeVariant();

    const res = await quote({ items: [{ variantId: variant.id, quantity: 1 }] });

    const { data } = res.body as {
      data: {
        shippingMinor: unknown;
        totalMinor: unknown;
        deliveryOptions: { feeMinor: unknown }[];
      };
    };
    expect(res.status).toBe(200);
    expect(data.shippingMinor).toBeNull();
    expect(data.totalMinor).toBeNull();
    expect(data.deliveryOptions.every((option) => option.feeMinor === null)).toBe(true);
  });

  it('reports each problem as a line status and leaves it out of the subtotal', async () => {
    const short = await makeVariant({ priceMinor: 1_000, stockQuantity: 1 });
    const gone = await makeVariant({ priceMinor: 2_000, stockQuantity: 0 });
    const hidden = await makeVariant({ priceMinor: 3_000 });
    const fine = await makeVariant({ priceMinor: 4_000 });
    await prisma.product.update({
      where: { id: hidden.product.id },
      data: { status: 'ARCHIVED' },
    });

    const res = await quote({
      items: [
        { variantId: short.variant.id, quantity: 2 },
        { variantId: gone.variant.id, quantity: 1 },
        { variantId: hidden.variant.id, quantity: 1 },
        { variantId: fine.variant.id, quantity: 1 },
      ],
    });

    const { data } = res.body as {
      data: { hasIssues: boolean; subtotalMinor: number; items: { status: string }[] };
    };
    expect(data.items.map((line) => line.status)).toEqual([
      'insufficient_stock',
      'out_of_stock',
      'unavailable',
      'available',
    ]);
    expect(data.hasIssues).toBe(true);
    expect(data.subtotalMinor).toBe(4_000);
  });

  it('answers 404 for a variant that does not exist', async () => {
    const res = await quote({ items: [{ variantId: 'cm000000000000000000000', quantity: 1 }] });

    expect(res.status).toBe(404);
  });

  it('never exposes stock counts', async () => {
    const { variant } = await makeVariant();

    const res = await quote({ items: [{ variantId: variant.id, quantity: 1 }] });
    const keys = allKeys(res.body);

    expect(keys.has('stockQuantity')).toBe(false);
    expect(keys.has('lowStockThreshold')).toBe(false);
  });
});

describe('POST /checkout', () => {
  it('creates a COD order with snapshots, a claim, a payment, history and a receipt', async () => {
    const { product, variant } = await makeVariant({ priceMinor: 100_000, stockQuantity: 5 });

    const res = await place(
      orderBody([{ variantId: variant.id, quantity: 2, priceMinor: 100_000 }]),
    );

    expect(res.status).toBe(201);
    const order = (res.body as { data: Record<string, unknown> & { id: string } }).data;
    expect(order).toMatchObject({
      status: 'CONFIRMED',
      paymentStatus: 'COD_PENDING',
      paymentMethod: 'COD',
      currency: 'BDT',
      subtotalMinor: 200_000,
      shippingMinor: STANDARD_DHAKA,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 200_000 + STANDARD_DHAKA,
      contact: { email: customer.email, phone: SHIPPING.phone },
      shipping: { recipientName: 'Test Person', city: 'Dhaka', method: 'standard' },
    });
    expect(order.orderNumber).toMatch(/^CC-[0-9A-Z]{12}$/);

    const row = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { items: true, payments: true, statusHistory: true },
    });

    expect(row.userId).toBe(customer.userId);
    expect(row.items).toHaveLength(1);
    expect(row.items[0]).toMatchObject({
      productId: product.id,
      variantId: variant.id,
      productNameSnapshot: 'Checkout Shoe',
      skuSnapshot: variant.sku,
      variantOptionsSnapshot: { color: 'Black', size: 'M' },
      unitPriceMinor: 100_000,
      quantity: 2,
      lineTotalMinor: 200_000,
    });
    expect(row.payments).toHaveLength(1);
    expect(row.payments[0]).toMatchObject({
      provider: 'cod',
      method: 'COD',
      status: 'PENDING',
      amountMinor: row.totalMinor,
      currency: 'BDT',
    });
    expect(row.statusHistory).toHaveLength(1);
    expect(row.statusHistory[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'CONFIRMED',
      actorUserId: customer.userId,
    });

    expect(await stockOf(variant.id)).toBe(3);
    const movements = await prisma.inventoryMovement.findMany({ where: { variantId: variant.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      delta: -2,
      resultingQuantity: 3,
      reason: 'ORDER_PLACED',
      orderId: order.id,
    });

    const receipt = await prisma.outboxEvent.findUniqueOrThrow({
      where: { dedupeKey: `order-receipt:${order.id}` },
    });
    expect(receipt.eventType).toBe('ORDER_RECEIPT');
    expect(receipt.status).toBe('PENDING');
    expect(allKeys(receipt.payload).has('contactEmail')).toBe(false);
  });

  it('does not expose idempotency or guest-token internals', async () => {
    const { variant } = await makeVariant();

    const res = await place(
      orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]),
    );
    const keys = allKeys(res.body);

    expect(res.status).toBe(201);
    for (const field of [
      'idempotencyKey',
      'requestFingerprint',
      'guestAccessTokenHash',
      'userId',
    ]) {
      expect(keys.has(field)).toBe(false);
    }
  });

  it('charges the server price and refuses a total the customer was not shown', async () => {
    const { variant } = await makeVariant({ priceMinor: 100_000 });

    const res = await place(
      orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 100_000 }], {
        expectedTotalMinor: 1,
      }),
    );

    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('CONFLICT');
    expect(await stockOf(variant.id)).toBe(10);
    expect(await counts(variant.id)).toEqual({ orders: 0, items: 0, movements: 0 });
  });

  it('notices a price change between the quote and the order', async () => {
    const { variant } = await makeVariant({ priceMinor: 100_000 });
    const quoted = await quote({
      items: [{ variantId: variant.id, quantity: 1 }],
      destination: { city: 'Dhaka', countryCode: 'BD' },
    });
    const { totalMinor } = (quoted.body as { data: { totalMinor: number } }).data;

    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { priceMinor: 120_000 },
    });

    const res = await place(
      orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 100_000 }], {
        expectedTotalMinor: totalMinor,
      }),
    );

    expect(res.status).toBe(409);
    expect(await stockOf(variant.id)).toBe(10);
  });

  it('prices delivery from the address, not from the option the client prefers', async () => {
    const { variant } = await makeVariant({ priceMinor: 100_000 });
    const items = [{ variantId: variant.id, quantity: 1, priceMinor: 100_000 }];

    // A Sylhet address with the Dhaka total a tampering client would hope for.
    const cheap = await place(orderBody(items, { shipping: { ...SHIPPING, city: 'Sylhet' } }));
    const honest = await place(
      orderBody(items, {
        shipping: { ...SHIPPING, city: 'Sylhet' },
        expectedTotalMinor: 100_000 + STANDARD_OUTSIDE,
      }),
    );

    expect(cheap.status).toBe(409);
    expect(honest.status).toBe(201);
    expect((honest.body as { data: { shippingMinor: number } }).data.shippingMinor).toBe(
      STANDARD_OUTSIDE,
    );
  });

  it('refuses a product taken down after it was added, without claiming stock', async () => {
    const { product, variant } = await makeVariant();
    await prisma.product.update({ where: { id: product.id }, data: { status: 'ARCHIVED' } });

    const res = await place(
      orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]),
    );

    expect(res.status).toBe(409);
    expect(await stockOf(variant.id)).toBe(10);
  });

  it('removes bought lines from the bag and leaves the others', async () => {
    const bought = await makeVariant();
    const kept = await makeVariant();
    for (const variantId of [bought.variant.id, kept.variant.id]) {
      await request(app)
        .post(`${API}/cart/items`)
        .set('origin', ORIGIN)
        .set('cookie', customer.cookie)
        .send({ variantId, quantity: 1 });
    }

    const res = await place(
      orderBody([{ variantId: bought.variant.id, quantity: 1, priceMinor: 250_000 }]),
    );
    const cart = await request(app).get(`${API}/cart`).set('cookie', customer.cookie);

    expect(res.status).toBe(201);
    const lines = (cart.body as { data: { items: { variant: { id: string } }[] } }).data.items;
    expect(lines.map((line) => line.variant.id)).toEqual([kept.variant.id]);
  });

  it('does not touch another customer’s bag', async () => {
    const other = await signUp(app);
    const { variant } = await makeVariant();
    await request(app)
      .post(`${API}/cart/items`)
      .set('origin', ORIGIN)
      .set('cookie', other.cookie)
      .send({ variantId: variant.id, quantity: 1 });

    await place(orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]));

    const cart = await request(app).get(`${API}/cart`).set('cookie', other.cookie);
    expect((cart.body as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  });

  it('saves the address only when asked, and not again on a replay', async () => {
    const shopper = await signUp(app);
    const { variant } = await makeVariant();
    const items = [{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }];
    const key = randomUUID();

    await place(orderBody(items), undefined, shopper);
    expect(await prisma.address.count({ where: { userId: shopper.userId } })).toBe(0);

    const body = orderBody(items, { saveAddress: true });
    await place(body, key, shopper);
    await place(body, key, shopper);

    const saved = await prisma.address.findMany({ where: { userId: shopper.userId } });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ line1: SHIPPING.line1, phone: SHIPPING.phone });
  });
});

describe('low-stock alerts', () => {
  async function alertsFor(variantId: string) {
    return prisma.outboxEvent.count({
      where: { eventType: 'LOW_STOCK_ALERT', dedupeKey: { startsWith: `low-stock:${variantId}:` } },
    });
  }

  it('raises one when an order crosses the threshold, and not for later sales', async () => {
    const { variant } = await makeVariant({ stockQuantity: 5, lowStockThreshold: 3 });
    const one = [{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }];

    await place(orderBody(one)); // 4: still above
    expect(await alertsFor(variant.id)).toBe(0);

    await place(orderBody(one)); // 3: crossed
    expect(await alertsFor(variant.id)).toBe(1);

    await place(orderBody(one)); // 2: already low
    expect(await alertsFor(variant.id)).toBe(1);
  });
});

describe('rollback', () => {
  it('undoes every write when a later line cannot be claimed', async () => {
    const plenty = await makeVariant({ priceMinor: 1_000, stockQuantity: 5 });
    const scarce = await makeVariant({ priceMinor: 2_000, stockQuantity: 1 });
    await request(app)
      .post(`${API}/cart/items`)
      .set('origin', ORIGIN)
      .set('cookie', customer.cookie)
      .send({ variantId: plenty.variant.id, quantity: 1 });
    const ordersBefore = await prisma.order.count();
    const outboxBefore = await prisma.outboxEvent.count();

    const res = await place(
      orderBody([
        { variantId: plenty.variant.id, quantity: 2, priceMinor: 1_000 },
        { variantId: scarce.variant.id, quantity: 2, priceMinor: 2_000 },
      ]),
    );

    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('OUT_OF_STOCK');
    expect(await stockOf(plenty.variant.id)).toBe(5);
    expect(await stockOf(scarce.variant.id)).toBe(1);
    expect(await prisma.order.count()).toBe(ordersBefore);
    expect(await prisma.outboxEvent.count()).toBe(outboxBefore);
    expect(await counts(plenty.variant.id)).toEqual({ orders: 0, items: 0, movements: 0 });

    const cart = await request(app).get(`${API}/cart`).set('cookie', customer.cookie);
    expect((cart.body as { data: { items: unknown[] } }).data.items).toHaveLength(1);
  });
});

describe('idempotency', () => {
  it('returns the prior order for a repeated request, with no second effect', async () => {
    const { variant } = await makeVariant({ stockQuantity: 5 });
    const body = orderBody([{ variantId: variant.id, quantity: 2, priceMinor: 250_000 }]);
    const key = randomUUID();

    const first = await place(body, key);
    const second = await place(body, key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((second.body as { meta: { replayed: boolean } }).meta.replayed).toBe(true);
    expect((second.body as { data: { id: string } }).data.id).toBe(
      (first.body as { data: { id: string } }).data.id,
    );
    expect(await stockOf(variant.id)).toBe(3);
    expect(await counts(variant.id)).toEqual({ orders: 1, items: 1, movements: 1 });
  });

  it('treats a reordered item list as the same request', async () => {
    const a = await makeVariant({ priceMinor: 1_000 });
    const b = await makeVariant({ priceMinor: 2_000 });
    const key = randomUUID();
    const lineA = { variantId: a.variant.id, quantity: 1, priceMinor: 1_000 };
    const lineB = { variantId: b.variant.id, quantity: 1, priceMinor: 2_000 };

    const first = await place(orderBody([lineA, lineB]), key);
    const second = await place(orderBody([lineB, lineA]), key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(await stockOf(a.variant.id)).toBe(9);
  });

  it('still returns the order after its total would no longer match', async () => {
    const { variant } = await makeVariant({ priceMinor: 100_000 });
    const body = orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 100_000 }]);
    const key = randomUUID();

    const first = await place(body, key);
    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { priceMinor: 500_000 },
    });
    const replay = await place(body, key);

    expect(replay.status).toBe(200);
    expect((replay.body as { data: { id: string; totalMinor: number } }).data).toMatchObject({
      id: (first.body as { data: { id: string } }).data.id,
      totalMinor: 100_000 + STANDARD_DHAKA,
    });
  });

  it('answers 409 IDEMPOTENCY_CONFLICT for the same key with a different request', async () => {
    const { variant } = await makeVariant({ stockQuantity: 5 });
    const key = randomUUID();
    const line = { variantId: variant.id, quantity: 1, priceMinor: 250_000 };

    await place(orderBody([line]), key);
    const moreItems = await place(orderBody([{ ...line, quantity: 2 }]), key);
    const otherAddress = await place(
      orderBody([line], { shipping: { ...SHIPPING, line1: '2 Other Road' } }),
      key,
    );

    for (const res of [moreItems, otherAddress]) {
      expect(res.status).toBe(409);
      expect((res.body as { error: { code: string } }).error.code).toBe('IDEMPOTENCY_CONFLICT');
    }
    expect(await stockOf(variant.id)).toBe(4);
    expect(await counts(variant.id)).toEqual({ orders: 1, items: 1, movements: 1 });
  });

  it('scopes a key to its customer: another account gets its own order', async () => {
    const other = await signUp(app);
    const { variant } = await makeVariant({ stockQuantity: 5 });
    const body = orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]);
    const key = randomUUID();

    const mine = await place(body, key);
    const theirs = await place(body, key, other);

    expect(mine.status).toBe(201);
    expect(theirs.status).toBe(201);
    expect((theirs.body as { data: { id: string } }).data.id).not.toBe(
      (mine.body as { data: { id: string } }).data.id,
    );
    expect(await stockOf(variant.id)).toBe(3);
  });

  it('lets a key that failed before commit be used again', async () => {
    const { variant } = await makeVariant({ stockQuantity: 0 });
    const body = orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]);
    const key = randomUUID();

    const soldOut = await place(body, key);
    expect(soldOut.status).toBe(409);

    await prisma.productVariant.update({ where: { id: variant.id }, data: { stockQuantity: 1 } });
    const restocked = await place(body, key);

    expect(restocked.status).toBe(201);
    expect(await stockOf(variant.id)).toBe(0);
  });

  it('settles concurrent duplicates on one order and one claim', async () => {
    const { variant } = await makeVariant({ stockQuantity: 10 });
    const body = orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]);
    const key = randomUUID();

    const responses = await Promise.all(Array.from({ length: 5 }, () => place(body, key)));

    expect(responses.map((res) => res.status).sort()).toEqual([200, 200, 200, 200, 201]);
    const ids = new Set(responses.map((res) => (res.body as { data: { id: string } }).data.id));
    expect(ids.size).toBe(1);
    expect(await stockOf(variant.id)).toBe(9);
    expect(await counts(variant.id)).toEqual({ orders: 1, items: 1, movements: 1 });
  });
});

describe('concurrency', () => {
  it('sells the final unit once, whoever asks at the same moment', async () => {
    const { variant } = await makeVariant({ stockQuantity: 1 });
    const body = orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]);
    const shoppers = await Promise.all(Array.from({ length: 5 }, () => signUp(app)));

    const responses = await Promise.all(
      shoppers.map((shopper) => place(body, randomUUID(), shopper)),
    );

    const statuses = responses.map((res) => res.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    for (const res of responses.filter((candidate) => candidate.status === 409)) {
      expect((res.body as { error: { code: string } }).error.code).toBe('OUT_OF_STOCK');
    }
    expect(await stockOf(variant.id)).toBe(0);
    expect(await counts(variant.id)).toEqual({ orders: 1, items: 1, movements: 1 });
  });

  it('does not deadlock when concurrent orders name variants in opposite orders', async () => {
    const a = await makeVariant({ priceMinor: 1_000, stockQuantity: 20 });
    const b = await makeVariant({ priceMinor: 2_000, stockQuantity: 20 });
    const lineA = { variantId: a.variant.id, quantity: 1, priceMinor: 1_000 };
    const lineB = { variantId: b.variant.id, quantity: 1, priceMinor: 2_000 };

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        place(orderBody(index % 2 === 0 ? [lineA, lineB] : [lineB, lineA])),
      ),
    );

    expect(responses.every((res) => res.status === 201)).toBe(true);
    expect(await stockOf(a.variant.id)).toBe(14);
    expect(await stockOf(b.variant.id)).toBe(14);
  });
});

describe('order history', () => {
  it('survives later catalog edits, an archive and losing its product reference', async () => {
    const { product, variant } = await makeVariant({ priceMinor: 100_000 });
    const placed = await place(
      orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 100_000 }]),
    );
    const orderId = (placed.body as { data: { id: string } }).data.id;

    await prisma.productVariant.update({
      where: { id: variant.id },
      data: { priceMinor: 999_999, sku: 'RENAMED-SKU', options: { color: 'Red', size: 'XL' } },
    });
    await prisma.product.update({
      where: { id: product.id },
      data: { name: 'Renamed Shoe', status: 'ARCHIVED' },
    });

    const res = await request(app).get(`${API}/orders/${orderId}`).set('cookie', customer.cookie);

    expect(res.status).toBe(200);
    const { data } = res.body as {
      data: { subtotalMinor: number; items: Record<string, unknown>[] };
    };
    expect(data.subtotalMinor).toBe(100_000);
    expect(data.items[0]).toMatchObject({
      productNameSnapshot: 'Checkout Shoe',
      skuSnapshot: variant.sku,
      color: 'Black',
      size: 'M',
      unitPriceMinor: 100_000,
      lineTotalMinor: 100_000,
    });

    // What a hard delete leaves behind: `order_items.product_id` is ON DELETE SET NULL.
    await prisma.orderItem.updateMany({ where: { orderId }, data: { productId: null } });
    const after = await request(app).get(`${API}/orders/${orderId}`).set('cookie', customer.cookie);

    expect(after.status).toBe(200);
    expect(
      (after.body as { data: { items: Record<string, unknown>[] } }).data.items[0],
    ).toMatchObject({ productNameSnapshot: 'Checkout Shoe', image: null });
  });

  it('keeps an order private to its owner', async () => {
    const stranger = await signUp(app);
    const admin = await signUpAs(app, UserRole.ADMIN);
    const { variant } = await makeVariant();
    const placed = await place(
      orderBody([{ variantId: variant.id, quantity: 1, priceMinor: 250_000 }]),
    );
    const orderId = (placed.body as { data: { id: string } }).data.id;

    const theirs = await request(app)
      .get(`${API}/orders/${orderId}`)
      .set('cookie', stranger.cookie);
    const list = await request(app).get(`${API}/orders`).set('cookie', stranger.cookie);
    const adminRead = await request(app)
      .get(`${API}/admin/orders/${orderId}`)
      .set('cookie', admin.cookie);

    expect(theirs.status).toBe(404);
    expect((list.body as { data: unknown[] }).data).toHaveLength(0);
    expect(adminRead.status).toBe(200);
  });
});

describe('rate limiting', () => {
  it('counts checkout against its own allowance', async () => {
    const limited = createTestApp({ checkout: { windowMs: 60_000, limit: 2 } });
    const shopper = await signUp(limited);
    const { variant } = await makeVariant();
    const send = () =>
      request(limited)
        .post(`${CHECKOUT}/quote`)
        .set('origin', ORIGIN)
        .set('cookie', shopper.cookie)
        .send({ items: [{ variantId: variant.id, quantity: 1 }] });

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);

    const refused = await send();
    expect(refused.status).toBe(429);
    expect((refused.body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
  });
});
