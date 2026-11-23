import { randomUUID } from 'node:crypto';

import { UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FakeSslcommerz } from '../../scripts/payments/fake-sslcommerz.js';
import { prisma } from '../../src/lib/prisma.js';
import { runDueJobs } from '../../src/modules/jobs/worker.js';
import type { EmailMessage } from '../../src/modules/notifications/transport.js';
import { deliveryFeeMinor } from '../../src/modules/pricing/pricing.js';
import { makeCategory, makeProduct } from './catalog-fixtures.js';
import {
  API,
  ORIGIN,
  type TestSession,
  createTestApp,
  signUp,
  signUpAs,
  truncateAll,
} from './harness.js';

/**
 * M10 (ADR 0022): coupons at checkout and their limits under concurrency, store settings, the
 * overview, the audit log and the order export — through the real app and PostgreSQL. Each test
 * names the failure it guards against (implementation-plan.md M10).
 */
const app = createTestApp();
const BOM = String.fromCharCode(0xfeff);
const PRICE = 250_000;
const FEE = deliveryFeeMinor('standard', { city: 'Dhaka', countryCode: 'BD' });
const SHIPPING = {
  recipientName: 'Test Person',
  phone: '+880 1700-000000',
  line1: '1 Test Road',
  city: 'Dhaka',
  postalCode: '1207',
  countryCode: 'BD',
};

const gateway = new FakeSslcommerz({
  storeId: process.env.SSLCOMMERZ_STORE_ID ?? '',
  storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD ?? '',
  port: 4599,
});

let customer: TestSession;
let admin: TestSession;
let superadmin: TestSession;
let categoryId: string;

beforeAll(async () => {
  await truncateAll();
  await gateway.start();
  customer = await signUp(app);
  admin = await signUpAs(app, UserRole.ADMIN);
  superadmin = await signUpAs(app, UserRole.SUPERADMIN);
  categoryId = (await makeCategory('m10-shoes')).id;
});

afterAll(async () => {
  await gateway.stop();
  await prisma.$disconnect();
});

afterEach(async () => {
  // Settings are global: no test may leave them changed for the next.
  await prisma.storeSettings.deleteMany();
  gateway.reset();
});

function get(path: string, session: TestSession = admin) {
  return request(app).get(`${API}${path}`).set('cookie', session.cookie);
}

function send(
  method: 'post' | 'patch' | 'put',
  path: string,
  body: object,
  session: TestSession = admin,
) {
  const agent = request(app);
  const call =
    method === 'post'
      ? agent.post(`${API}${path}`)
      : method === 'patch'
        ? agent.patch(`${API}${path}`)
        : agent.put(`${API}${path}`);
  return call.set('origin', ORIGIN).set('cookie', session.cookie).send(body);
}

async function makeVariant(stockQuantity = 50, priceMinor = PRICE) {
  const { product, variants } = await makeProduct({
    categoryId,
    name: `M10 Shoe ${randomUUID().slice(0, 6)}`,
    variants: [{ size: 'M', priceMinor, stockQuantity, lowStockThreshold: 0 }],
  });
  const variant = variants[0];
  if (!variant) throw new Error('fixture has no variant');
  return { productId: product.id, variantId: variant.id };
}

async function makeCoupon(body: Record<string, unknown> = {}) {
  const res = await send('post', '/admin/coupons', {
    code: `C${randomUUID().slice(0, 8)}`,
    type: 'PERCENT',
    percentBps: 1000,
    ...body,
  });
  expect(res.status).toBe(201);
  return (res.body as { data: { id: string; code: string } }).data;
}

function quote(variantId: string, couponCode?: string, session: TestSession = customer) {
  return send(
    'post',
    '/checkout/quote',
    {
      items: [{ variantId, quantity: 1 }],
      destination: { city: 'Dhaka', countryCode: 'BD' },
      ...(couponCode ? { couponCode } : {}),
    },
    session,
  );
}

function place(
  variantId: string,
  options: {
    couponCode?: string;
    expectedTotalMinor: number;
    session?: TestSession;
    key?: string;
    paymentMethod?: 'COD' | 'ONLINE';
  },
) {
  return request(app)
    .post(`${API}/checkout`)
    .set('origin', ORIGIN)
    .set('cookie', (options.session ?? customer).cookie)
    .set('idempotency-key', options.key ?? randomUUID())
    .send({
      items: [{ variantId, quantity: 1 }],
      shipping: SHIPPING,
      deliveryOption: 'standard',
      paymentMethod: options.paymentMethod ?? 'COD',
      expectedTotalMinor: options.expectedTotalMinor,
      ...(options.couponCode ? { couponCode: options.couponCode } : {}),
    });
}

const usedCount = async (id: string) =>
  (await prisma.coupon.findUniqueOrThrow({ where: { id } })).usedCount;

// ---------------------------------------------------------------------------
// Coupons: administration
// ---------------------------------------------------------------------------

describe('coupon administration', () => {
  it('creates a coupon, audited, and refuses a duplicate code', async () => {
    const coupon = await makeCoupon({ code: 'welcome10' });
    expect(coupon.code).toBe('WELCOME10');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'coupon.created', entityId: coupon.id },
    });
    expect(audit.actorUserId).toBe(admin.userId);

    expect(
      (
        await send('post', '/admin/coupons', {
          code: 'WELCOME10',
          type: 'PERCENT',
          percentBps: 500,
        })
      ).status,
    ).toBe(409);
  });

  it('refuses customers, and terms that do not fit the type', async () => {
    expect(
      (
        await send(
          'post',
          '/admin/coupons',
          { code: 'NOPE1', type: 'PERCENT', percentBps: 500 },
          customer,
        )
      ).status,
    ).toBe(403);
    expect((await get('/admin/coupons', customer)).status).toBe(403);
    expect(
      (await send('post', '/admin/coupons', { code: 'BAD1', type: 'PERCENT', valueMinor: 100 }))
        .status,
    ).toBe(400);
    expect(
      (await send('post', '/admin/coupons', { code: 'BAD2', type: 'PERCENT', percentBps: 10_001 }))
        .status,
    ).toBe(400);
    expect(
      (
        await send('post', '/admin/coupons', {
          code: 'BAD3',
          type: 'FIXED',
          valueMinor: 100,
          appliesToAllProducts: false,
          productIds: [],
        })
      ).status,
    ).toBe(400);
  });

  it('will not lower a limit below the uses already made, and audits a change', async () => {
    const { variantId } = await makeVariant();
    const coupon = await makeCoupon({ usageLimit: 5 });

    const priced = (await quote(variantId, coupon.code)).body as { data: { totalMinor: number } };
    expect(
      (
        await place(variantId, {
          couponCode: coupon.code,
          expectedTotalMinor: priced.data.totalMinor,
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await place(variantId, {
          couponCode: coupon.code,
          expectedTotalMinor: priced.data.totalMinor,
        })
      ).status,
    ).toBe(201);

    expect((await send('patch', `/admin/coupons/${coupon.id}`, { usageLimit: 1 })).status).toBe(
      409,
    );
    const ok = await send('patch', `/admin/coupons/${coupon.id}`, {
      usageLimit: 2,
      isActive: false,
    });
    expect(ok.status).toBe(200);
    expect((ok.body as { data: { state: string } }).data.state).toBe('inactive');
    expect(
      await prisma.auditLog.count({ where: { action: 'coupon.updated', entityId: coupon.id } }),
    ).toBe(1);

    const listed = await get('/admin/coupons?state=inactive');
    expect((listed.body as { data: { id: string }[] }).data.map((row) => row.id)).toContain(
      coupon.id,
    );
  });
});

// ---------------------------------------------------------------------------
// Coupons at checkout
// ---------------------------------------------------------------------------

describe('coupons at checkout', () => {
  it('quotes a discount, places the order with it, and snapshots the code', async () => {
    const { variantId } = await makeVariant();
    const coupon = await makeCoupon({ percentBps: 2000 });

    const res = await quote(variantId, coupon.code.toLowerCase());
    const data = (
      res.body as { data: { discountMinor: number; totalMinor: number; coupon: object } }
    ).data;
    expect(data.coupon).toMatchObject({
      code: coupon.code,
      status: 'applied',
      discountMinor: 50_000,
    });
    expect(data.discountMinor).toBe(50_000);
    expect(data.totalMinor).toBe(PRICE - 50_000 + FEE);

    const placed = await place(variantId, {
      couponCode: coupon.code,
      expectedTotalMinor: data.totalMinor,
    });
    expect(placed.status).toBe(201);
    const orderId = (placed.body as { data: { id: string } }).data.id;

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order).toMatchObject({
      discountMinor: 50_000,
      couponId: coupon.id,
      couponCodeSnapshot: coupon.code,
    });
    expect(await prisma.couponRedemption.count({ where: { orderId, releasedAt: null } })).toBe(1);
    expect(await usedCount(coupon.id)).toBe(1);
  });

  it('reports a code that does not apply in the quote, and refuses the order', async () => {
    const { variantId } = await makeVariant();
    await makeCoupon({ code: 'BIGSPEND', minimumSpendMinor: 10_000_000 });

    const res = await quote(variantId, 'BIGSPEND');
    expect(res.status).toBe(200);
    expect((res.body as { data: { coupon: object; discountMinor: number } }).data).toMatchObject({
      discountMinor: 0,
      coupon: { status: 'refused', message: expect.stringContaining('minimum spend') as string },
    });
    expect((await quote(variantId, 'NOSUCHCODE')).body).toMatchObject({
      data: { coupon: { status: 'refused' } },
    });

    const refused = await place(variantId, {
      couponCode: 'BIGSPEND',
      expectedTotalMinor: PRICE + FEE,
    });
    expect(refused.status).toBe(409);
    expect((refused.body as { error: { code: string } }).error.code).toBe('COUPON_INVALID');
    // Nothing committed: no order, no stock claimed.
    expect(await prisma.order.count({ where: { couponCodeSnapshot: 'BIGSPEND' } })).toBe(0);
  });

  it('treats a different code under the same key as a different request', async () => {
    const { variantId } = await makeVariant();
    const coupon = await makeCoupon();
    const key = randomUUID();

    expect((await place(variantId, { key, expectedTotalMinor: PRICE + FEE })).status).toBe(201);
    const again = await place(variantId, {
      key,
      couponCode: coupon.code,
      expectedTotalMinor: PRICE - 25_000 + FEE,
    });
    expect(again.status).toBe(409);
    expect((again.body as { error: { code: string } }).error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('never exceeds a usage limit under concurrent checkouts', async () => {
    const { variantId } = await makeVariant(100);
    const coupon = await makeCoupon({ usageLimit: 3 });
    const total = PRICE - 25_000 + FEE;
    const shoppers = await Promise.all(Array.from({ length: 8 }, () => signUp(app)));

    const results = await Promise.all(
      shoppers.map((session) =>
        place(variantId, { couponCode: coupon.code, expectedTotalMinor: total, session }),
      ),
    );
    const statuses = results.map((res) => res.status);

    expect(statuses.filter((status) => status === 201)).toHaveLength(3);
    for (const res of results.filter((r) => r.status !== 201)) {
      expect((res.body as { error: { code: string } }).error.code).toBe('COUPON_INVALID');
    }
    expect(await usedCount(coupon.id)).toBe(3);
    expect(await prisma.couponRedemption.count({ where: { couponId: coupon.id } })).toBe(3);
    // The refused orders claimed no stock.
    expect(
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity,
    ).toBe(97);
  });

  it('never exceeds a per-customer limit under concurrent checkouts by one customer', async () => {
    const { variantId } = await makeVariant(100);
    const coupon = await makeCoupon({ perUserLimit: 1 });
    const shopper = await signUp(app);
    const total = PRICE - 25_000 + FEE;

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        place(variantId, { couponCode: coupon.code, expectedTotalMinor: total, session: shopper }),
      ),
    );

    expect(results.filter((res) => res.status === 201)).toHaveLength(1);
    expect(
      await prisma.couponRedemption.count({
        where: { couponId: coupon.id, userId: shopper.userId },
      }),
    ).toBe(1);
    // The quote says so too.
    expect((await quote(variantId, coupon.code, shopper)).body).toMatchObject({
      data: {
        coupon: {
          status: 'refused',
          message: expect.stringContaining('already been used') as string,
        },
      },
    });
  });

  it('gives a use back when the order is cancelled', async () => {
    const { variantId } = await makeVariant();
    const coupon = await makeCoupon({ usageLimit: 1 });
    const shopper = await signUp(app);
    const total = PRICE - 25_000 + FEE;

    const placed = await place(variantId, {
      couponCode: coupon.code,
      expectedTotalMinor: total,
      session: shopper,
    });
    expect(placed.status).toBe(201);
    const orderId = (placed.body as { data: { id: string } }).data.id;
    expect(await usedCount(coupon.id)).toBe(1);

    const cancelled = await send(
      'post',
      `/orders/${orderId}/cancel`,
      { reason: 'Changed my mind' },
      shopper,
    );
    expect(cancelled.status).toBe(200);
    expect(await usedCount(coupon.id)).toBe(0);
    expect(
      (await prisma.couponRedemption.findFirstOrThrow({ where: { orderId } })).releasedAt,
    ).not.toBeNull();

    // The single use is available again.
    expect(
      (
        await place(variantId, {
          couponCode: coupon.code,
          expectedTotalMinor: total,
          session: shopper,
        })
      ).status,
    ).toBe(201);
    expect(await usedCount(coupon.id)).toBe(1);
  });

  it('gives a use back when the online payment fails', async () => {
    const { variantId } = await makeVariant();
    const coupon = await makeCoupon({ usageLimit: 1 });
    const total = PRICE - 25_000 + FEE;

    const placed = await place(variantId, {
      couponCode: coupon.code,
      expectedTotalMinor: total,
      paymentMethod: 'ONLINE',
    });
    expect(placed.status).toBe(201);
    const orderId = (placed.body as { data: { id: string } }).data.id;
    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });
    expect((await send('post', `/orders/${orderId}/payment-session`, {}, customer)).status).toBe(
      200,
    );

    gateway.settle(payment.id, 'FAILED');
    const ipn = await request(app)
      .post(`${API}/webhooks/payments/sslcommerz`)
      .type('form')
      .send(gateway.ipnFields(payment.id));
    expect(ipn.status).toBe(200);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
      'PAYMENT_FAILED',
    );
    expect(await usedCount(coupon.id)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Store settings
// ---------------------------------------------------------------------------

describe('store settings', () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    version: 0,
    storeName: 'Evora Test',
    supportEmail: 'help@example.test',
    standardFeeDhakaMinor: 6_000,
    standardFeeNationalMinor: 12_000,
    expressEnabled: false,
    expressFeeDhakaMinor: 15_000,
    expressFeeNationalMinor: 25_000,
    freeShippingThresholdMinor: null,
    taxRateBps: 500,
    ...overrides,
  });

  it('starts from the defaults and saves, audited with what changed', async () => {
    const before = await get('/admin/settings');
    expect((before.body as { data: object }).data).toMatchObject({
      version: 0,
      standardFeeDhakaMinor: FEE,
      taxRateBps: 0,
    });

    const saved = await send('put', '/admin/settings', body());
    expect(saved.status).toBe(200);
    expect((saved.body as { data: object }).data).toMatchObject({
      version: 1,
      storeName: 'Evora Test',
      updatedBy: { id: admin.userId },
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'settings.updated' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.beforeData).toMatchObject({ standardFeeDhakaMinor: FEE, taxRateBps: 0 });
    expect(audit.afterData).toMatchObject({ standardFeeDhakaMinor: 6_000, taxRateBps: 500 });
  });

  it('refuses a save over a newer version, and customers', async () => {
    expect((await send('put', '/admin/settings', body())).status).toBe(200);
    expect((await send('put', '/admin/settings', body({ version: 0 }))).status).toBe(409);
    expect(
      (await send('put', '/admin/settings', body({ version: 1, storeName: 'Second' }))).status,
    ).toBe(200);
    expect((await send('put', '/admin/settings', body({ version: 1 }))).status).toBe(409);
    expect((await send('put', '/admin/settings', body({ version: 2 }), customer)).status).toBe(403);
    expect(
      (await send('put', '/admin/settings', body({ version: 2, taxRateBps: 9000 }))).status,
    ).toBe(400);
  });

  it('prices checkout with what was saved: fees, tax, free delivery and switched-off options', async () => {
    const { variantId } = await makeVariant();
    expect(
      (await send('put', '/admin/settings', body({ freeShippingThresholdMinor: 300_000 }))).status,
    ).toBe(200);

    const res = await quote(variantId);
    const data = (
      res.body as {
        data: {
          shippingMinor: number;
          taxMinor: number;
          totalMinor: number;
          deliveryOptions: { id: string }[];
        };
      }
    ).data;
    expect(data.shippingMinor).toBe(6_000);
    expect(data.taxMinor).toBe(12_500);
    expect(data.totalMinor).toBe(PRICE + 6_000 + 12_500);
    expect(data.deliveryOptions.map((option) => option.id)).toEqual(['standard']);

    // Express is off: refused even when asked for directly.
    const express = await request(app)
      .post(`${API}/checkout`)
      .set('origin', ORIGIN)
      .set('cookie', customer.cookie)
      .set('idempotency-key', randomUUID())
      .send({
        items: [{ variantId, quantity: 1 }],
        shipping: SHIPPING,
        deliveryOption: 'express',
        paymentMethod: 'COD',
        expectedTotalMinor: 1,
      });
    expect(express.status).toBe(400);

    const placed = await place(variantId, { expectedTotalMinor: data.totalMinor });
    expect(placed.status).toBe(201);
    expect((placed.body as { data: { taxMinor: number } }).data.taxMinor).toBe(12_500);

    // Over the threshold, delivery is free.
    const big = await makeVariant(10, 400_000);
    expect((await quote(big.variantId)).body).toMatchObject({ data: { shippingMinor: 0 } });
  });

  it('names the store and its support address in the emails it sends', async () => {
    expect((await send('put', '/admin/settings', body())).status).toBe(200);
    const { variantId } = await makeVariant();
    const placed = await place(variantId, { expectedTotalMinor: PRICE + 6_000 + 12_500 });
    const orderId = (placed.body as { data: { id: string } }).data.id;
    await prisma.outboxEvent.deleteMany({
      where: { NOT: { dedupeKey: `order-receipt:${orderId}` } },
    });

    const sent: EmailMessage[] = [];
    await runDueJobs({
      transport: {
        name: 'recording',
        send: (message) => {
          sent.push(message);
          return Promise.resolve();
        },
      },
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain('Evora Test');
    expect(sent[0]?.text).toContain('help@example.test');
  });
});

// ---------------------------------------------------------------------------
// Overview, audit log, export
// ---------------------------------------------------------------------------

describe('overview, audit log and export', () => {
  async function orderAt(
    createdAt: Date,
    status: 'CONFIRMED' | 'CANCELLED' | 'DELIVERED',
    totalMinor: number,
  ) {
    return prisma.order.create({
      data: {
        orderNumber: `ORD-${randomUUID().slice(0, 10).toUpperCase()}`,
        userId: customer.userId,
        status,
        paymentMethod: 'COD',
        currency: 'BDT',
        subtotalMinor: totalMinor,
        totalMinor,
        contactEmail: customer.email,
        shipRecipientName: 'Test Person',
        shipLine1: '1 Test Road',
        shipCity: '=HYPERLINK("http://evil")',
        shipPostalCode: '1207',
        shipCountryCode: 'BD',
        createdAt,
        items: {
          create: {
            productNameSnapshot: 'Overview Shoe',
            skuSnapshot: 'OV-1',
            unitPriceMinor: totalMinor,
            quantity: 1,
            lineTotalMinor: totalMinor,
          },
        },
      },
    });
  }

  it('adds up counted sales by store day, and refuses an unbounded range', async () => {
    // 2025: far from every other test's orders. 23:30 Dhaka on 1 Jan is still 1 Jan.
    await orderAt(new Date('2025-01-01T17:30:00Z'), 'CONFIRMED', 10_000);
    await orderAt(new Date('2025-01-02T03:00:00Z'), 'DELIVERED', 20_000);
    await orderAt(new Date('2025-01-02T04:00:00Z'), 'CANCELLED', 99_000);

    const res = await get('/admin/overview?from=2025-01-01&to=2025-01-03');
    expect(res.status).toBe(200);
    const data = (res.body as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({
      ordersPlaced: 3,
      ordersCounted: 2,
      salesMinor: 30_000,
      averageOrderMinor: 15_000,
      byStatus: { CONFIRMED: 1, DELIVERED: 1, CANCELLED: 1 },
      daily: [
        { date: '2025-01-01', orders: 1, salesMinor: 10_000 },
        { date: '2025-01-02', orders: 1, salesMinor: 20_000 },
        { date: '2025-01-03', orders: 0, salesMinor: 0 },
      ],
    });
    expect((data['topProducts'] as { name: string; units: number }[])[0]).toMatchObject({
      name: 'Overview Shoe',
      units: 2,
    });

    expect((await get('/admin/overview?from=2024-01-01&to=2025-12-31')).status).toBe(400);
    expect((await get('/admin/overview?from=2025-02-01&to=2025-01-01')).status).toBe(400);
    expect((await get('/admin/overview', customer)).status).toBe(403);
  });

  it('exports orders as CSV, neutralising formulas, and audits the export', async () => {
    await orderAt(new Date('2025-03-01T06:00:00Z'), 'CONFIRMED', 12_345);

    const res = await get('/admin/reports/orders.csv?from=2025-03-01&to=2025-03-01');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toContain('orders-2025-03-01-to-2025-03-01.csv');

    const lines = res.text.replace(BOM, '').trim().split('\r\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"order_number"');
    expect(lines[1]).toContain('"123.45"');
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://evil"")"`);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'orders.exported' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.afterData).toMatchObject({ from: '2025-03-01', to: '2025-03-01', rows: 1 });

    expect((await get('/admin/reports/orders.csv?from=2020-01-01&to=2025-01-01')).status).toBe(400);
    expect((await get('/admin/reports/orders.csv', customer)).status).toBe(403);
  });

  it('lists the audit log with filters, showing IP addresses to superadmins only', async () => {
    await makeCoupon();

    const res = await get('/admin/audit-logs?action=coupon.created');
    expect(res.status).toBe(200);
    const rows = (res.body as { data: Record<string, unknown>[] }).data;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row['action'] === 'coupon.created')).toBe(true);
    expect(rows[0]).toMatchObject({ actor: { id: admin.userId } });
    expect(rows[0]).not.toHaveProperty('ipAddress');

    const asSuper = await get('/admin/audit-logs?action=coupon.created', superadmin);
    expect((asSuper.body as { data: Record<string, unknown>[] }).data[0]).toHaveProperty(
      'ipAddress',
    );

    expect((await get('/admin/audit-logs?action=made.up')).status).toBe(400);
    expect((await get('/admin/audit-logs', customer)).status).toBe(403);
  });
});
