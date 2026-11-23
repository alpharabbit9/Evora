import { randomUUID } from 'node:crypto';

import { UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  FakeSslcommerz,
  type FakeTransactionStatus,
  signFakeIpn,
} from '../../scripts/payments/fake-sslcommerz.js';
import { env } from '../../src/config/env.js';
import { prisma } from '../../src/lib/prisma.js';
import { withTransaction } from '../../src/lib/transaction.js';
import { releaseStock } from '../../src/modules/inventory/inventory.service.js';
import { PAYMENT_WINDOW_MS } from '../../src/modules/payments/payment-state.js';
import { reconcilePayments } from '../../src/modules/payments/payments.service.js';
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
 * The real app, the real SSLCOMMERZ adapter speaking HTTP, and real PostgreSQL. Only the gateway
 * on the other end is a stand-in. Each test names the failure it is about (API_SPEC.md §11, PRD §7).
 */
const app = createTestApp();

const STORE_PASSWORD = process.env.SSLCOMMERZ_STORE_PASSWORD ?? '';
const WEBHOOK = `${API}/webhooks/payments/sslcommerz`;
const FEE = deliveryFeeMinor('standard', { city: 'Dhaka', countryCode: 'BD' });
const PRICE = 250_000;

const gateway = new FakeSslcommerz({
  storeId: process.env.SSLCOMMERZ_STORE_ID ?? '',
  storePassword: STORE_PASSWORD,
  port: 4599,
});

let customer: TestSession;
let categoryId: string;

beforeAll(async () => {
  await truncateAll();
  await gateway.start();
  customer = await signUp(app);
  categoryId = (await makeCategory('payment-shoes')).id;
});

afterAll(async () => {
  await gateway.stop();
  await prisma.$disconnect();
});

beforeEach(async () => {
  gateway.reset();
  await prisma.cartItem.deleteMany();
});

async function makeVariant(stockQuantity = 10, priceMinor = PRICE) {
  const { variants } = await makeProduct({
    categoryId,
    name: 'Payment Shoe',
    variants: [{ size: 'M', priceMinor, stockQuantity, lowStockThreshold: 0 }],
  });
  const variant = variants[0];

  if (!variant) throw new Error('fixture has no variant');

  return variant;
}

function placeBody(variantId: string, overrides: Record<string, unknown> = {}) {
  return {
    items: [{ variantId, quantity: 1 }],
    shipping: {
      recipientName: 'Test Person',
      phone: '+880 1700-000000',
      line1: '1 Test Road',
      city: 'Dhaka',
      postalCode: '1207',
      countryCode: 'BD',
    },
    deliveryOption: 'standard',
    paymentMethod: 'ONLINE',
    expectedTotalMinor: PRICE + FEE,
    ...overrides,
  };
}

function post(path: string, session: TestSession = customer) {
  return request(app).post(path).set('origin', ORIGIN).set('cookie', session.cookie);
}

function get(path: string, session: TestSession = customer) {
  return request(app).get(path).set('cookie', session.cookie);
}

function startSession(orderId: string, session: TestSession = customer) {
  return post(`${API}/orders/${orderId}/payment-session`, session).send();
}

function sendIpn(fields: Record<string, string>) {
  return request(app).post(WEBHOOK).type('form').send(fields);
}

/** An online order with a live gateway session, its one unit of interest in the customer's bag. */
async function onlineOrder(stockQuantity = 10) {
  const variant = await makeVariant(stockQuantity);

  await post(`${API}/cart/items`).send({ variantId: variant.id, quantity: 1 }).expect(200);

  const placed = await post(`${API}/checkout`)
    .set('idempotency-key', randomUUID())
    .send(placeBody(variant.id));

  expect(placed.status).toBe(201);

  const orderId = (placed.body as { data: { id: string } }).data.id;
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });

  expect((await startSession(orderId)).status).toBe(200);

  return { orderId, paymentId: payment.id, variantId: variant.id };
}

/** Customer finished at the gateway, and the provider sends the (correctly signed) notification. */
function settleAndNotify(paymentId: string, status: FakeTransactionStatus) {
  gateway.settle(paymentId, status);

  return sendIpn(gateway.ipnFields(paymentId));
}

async function stateOf(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      status: true,
      paymentStatus: true,
      statusHistory: {
        orderBy: { createdAt: 'asc' },
        select: { fromStatus: true, toStatus: true },
      },
      payments: {
        select: { status: true, providerPaymentRef: true, capturedAt: true, failureCode: true },
      },
    },
  });
}

async function stockOf(variantId: string): Promise<number> {
  const { stockQuantity } = await prisma.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: { stockQuantity: true },
  });

  return stockQuantity;
}

function outboxCount(eventType: 'ORDER_RECEIPT' | 'PAYMENT_REVIEW_REQUIRED', orderId: string) {
  return prisma.outboxEvent.count({
    where: { eventType, payload: { path: ['orderId'], equals: orderId } },
  });
}

function bagCount(variantId: string) {
  return prisma.cartItem.count({ where: { variantId } });
}

describe('placing an online order', () => {
  it('holds stock and waits, with no receipt, an intact bag and no call to the provider', async () => {
    const variant = await makeVariant();
    await post(`${API}/cart/items`).send({ variantId: variant.id, quantity: 1 }).expect(200);
    const before = gateway.sessionRequests;

    const res = await post(`${API}/checkout`)
      .set('idempotency-key', randomUUID())
      .send(placeBody(variant.id));

    expect(res.status).toBe(201);
    const { data } = res.body as {
      data: { id: string; status: string; paymentStatus: string; payment: { canResume: boolean } };
    };
    expect(data.status).toBe('PENDING_PAYMENT');
    expect(data.paymentStatus).toBe('PENDING');
    expect(data.payment.canResume).toBe(true);
    expect(await stockOf(variant.id)).toBe(9);
    expect(await outboxCount('ORDER_RECEIPT', data.id)).toBe(0);
    expect(await bagCount(variant.id)).toBe(1);
    expect(gateway.sessionRequests).toBe(before);
  });

  it('cannot be told it is already paid', async () => {
    const variant = await makeVariant();

    const res = await post(`${API}/checkout`)
      .set('idempotency-key', randomUUID())
      .send(placeBody(variant.id, { paymentStatus: 'PAID' }));

    expect(res.status).toBe(400);
    expect(await stockOf(variant.id)).toBe(10);
  });

  it('refuses a total beyond what the provider accepts, and does not offer it either', async () => {
    const price = 60_000_000;
    const variant = await makeVariant(10, price);
    const total = price + FEE;

    const quote = await post(`${API}/checkout/quote`).send({
      items: [{ variantId: variant.id, quantity: 1 }],
      destination: { city: 'Dhaka', countryCode: 'BD' },
    });
    const placed = await post(`${API}/checkout`)
      .set('idempotency-key', randomUUID())
      .send(placeBody(variant.id, { expectedTotalMinor: total }));

    expect((quote.body as { data: { paymentMethods: string[] } }).data.paymentMethods).toEqual([
      'COD',
    ]);
    expect(placed.status).toBe(400);
    expect(await stockOf(variant.id)).toBe(10);
  });

  it('replays the same order for a repeated request', async () => {
    const variant = await makeVariant();
    const key = randomUUID();
    const body = placeBody(variant.id);

    const first = await post(`${API}/checkout`).set('idempotency-key', key).send(body);
    const second = await post(`${API}/checkout`).set('idempotency-key', key).send(body);

    expect(second.status).toBe(200);
    expect((second.body as { data: { id: string } }).data.id).toBe(
      (first.body as { data: { id: string } }).data.id,
    );
    expect(await stockOf(variant.id)).toBe(9);
  });
});

describe('POST /orders/:orderId/payment-session', () => {
  it('starts one session and reuses it when repeated', async () => {
    const { orderId, paymentId } = await onlineOrder();
    const requests = gateway.sessionRequests;

    const again = await startSession(orderId);

    expect(again.status).toBe(200);
    expect((again.body as { data: { redirectUrl: string } }).data.redirectUrl).toContain(
      gateway.transaction(paymentId).sessionKey,
    );
    expect(gateway.sessionRequests).toBe(requests);
  });

  it('sends the server-side amount, exactly', async () => {
    const { paymentId } = await onlineOrder();

    expect(gateway.transaction(paymentId).amount).toBe('2580.00');
    expect(gateway.transaction(paymentId).currency).toBe('BDT');
  });

  it('is not available to another customer or without a session', async () => {
    const { orderId } = await onlineOrder();
    const stranger = await signUp(app);

    expect((await startSession(orderId, stranger)).status).toBe(404);
    expect(
      (await request(app).post(`${API}/orders/${orderId}/payment-session`).set('origin', ORIGIN))
        .status,
    ).toBe(401);
  });

  it('refuses a cross-site request', async () => {
    const { orderId } = await onlineOrder();

    const res = await request(app)
      .post(`${API}/orders/${orderId}/payment-session`)
      .set('origin', 'https://evil.example')
      .set('cookie', customer.cookie);

    expect(res.status).toBe(403);
  });

  it('refuses a cash-on-delivery order and one no longer waiting', async () => {
    const variant = await makeVariant();
    const cod = await post(`${API}/checkout`)
      .set('idempotency-key', randomUUID())
      .send(placeBody(variant.id, { paymentMethod: 'COD' }));
    const { orderId, paymentId } = await onlineOrder();
    await settleAndNotify(paymentId, 'VALID');

    expect((await startSession((cod.body as { data: { id: string } }).data.id)).status).toBe(409);
    expect((await startSession(orderId)).status).toBe(409);
  });
});

describe('provider failures while starting a payment', () => {
  async function waitingOrder() {
    const variant = await makeVariant();
    const res = await post(`${API}/checkout`)
      .set('idempotency-key', randomUUID())
      .send(placeBody(variant.id));

    return { orderId: (res.body as { data: { id: string } }).data.id, variantId: variant.id };
  }

  it.each(['http500', 'garbage', 'refuseSession'] as const)(
    'leaves a recoverable order on %s, and a retry works',
    async (outage) => {
      const { orderId, variantId } = await waitingOrder();

      gateway.outage = outage;
      const failed = await startSession(orderId);

      expect(failed.status).toBe(503);
      expect((failed.body as { error: { code: string } }).error.code).toBe('PROVIDER_UNAVAILABLE');
      expect((await stateOf(orderId)).status).toBe('PENDING_PAYMENT');
      expect(await stockOf(variantId)).toBe(9);

      gateway.outage = 'none';
      expect((await startSession(orderId)).status).toBe(200);
    },
  );

  it('survives a provider that never answers', async () => {
    const { orderId } = await waitingOrder();

    gateway.outage = 'hang';
    const res = await startSession(orderId);

    expect(res.status).toBe(503);
    expect((await stateOf(orderId)).status).toBe('PENDING_PAYMENT');
  }, 20_000);
});

describe('webhook authenticity', () => {
  it('rejects a changed message and stores nothing', async () => {
    const { orderId, paymentId } = await onlineOrder();
    gateway.settle(paymentId, 'FAILED');
    const fields = gateway.ipnFields(paymentId);

    const res = await sendIpn({ ...fields, status: 'VALID', val_id: 'forged' });

    expect(res.status).toBe(401);
    expect(await prisma.webhookEvent.count({ where: { eventId: { startsWith: paymentId } } })).toBe(
      0,
    );
    expect((await stateOf(orderId)).status).toBe('PENDING_PAYMENT');
  });

  it('rejects one signed with the wrong password, and an unsigned one', async () => {
    const { paymentId } = await onlineOrder();
    const fields = { status: 'VALID', tran_id: paymentId, val_id: 'x' };

    expect((await sendIpn(signFakeIpn(fields, 'wrong'))).status).toBe(401);
    expect((await sendIpn(fields)).status).toBe(401);
  });

  it('does not treat a JSON body as a signed message', async () => {
    expect((await request(app).post(WEBHOOK).send({ status: 'VALID' })).status).toBe(401);
  });

  it('does not need a session or a trusted Origin, because the provider has neither', async () => {
    const { paymentId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID');

    const res = await request(app)
      .post(WEBHOOK)
      .set('origin', 'https://securepay.example')
      .type('form')
      .send(gateway.ipnFields(paymentId));

    expect(res.status).toBe(200);
  });

  it('answers 404 for a provider that does not exist', async () => {
    expect(
      (await request(app).post(`${API}/webhooks/payments/nope`).type('form').send({ a: 'b' }))
        .status,
    ).toBe(404);
  });

  it('acknowledges a signed message about no payment of ours, and records it', async () => {
    const tranId = `unknown-${randomUUID()}`;
    const fields = signFakeIpn({ status: 'VALID', tran_id: tranId, val_id: 'v1' }, STORE_PASSWORD);

    expect((await sendIpn(fields)).status).toBe(200);

    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { eventId: { startsWith: tranId } },
    });
    expect(event.status).toBe('FAILED');
    expect(event.lastError).toBe('UNKNOWN_PAYMENT');
  });
});

describe('a verified success', () => {
  it('confirms the order, captures the payment, queues the receipt and empties the bag', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();

    const res = await settleAndNotify(paymentId, 'VALID');

    expect(res.status).toBe(200);
    const state = await stateOf(orderId);
    expect(state.status).toBe('CONFIRMED');
    expect(state.paymentStatus).toBe('PAID');
    expect(state.payments[0]?.status).toBe('SUCCEEDED');
    expect(state.payments[0]?.providerPaymentRef).toBe(gateway.transaction(paymentId).valId);
    expect(state.payments[0]?.capturedAt).toBeInstanceOf(Date);
    expect(state.statusHistory.at(-1)).toEqual({
      fromStatus: 'PENDING_PAYMENT',
      toStatus: 'CONFIRMED',
    });
    expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(1);
    expect(await bagCount(variantId)).toBe(0);
    // Stock was claimed at order time and is not claimed twice.
    expect(await stockOf(variantId)).toBe(9);
  });

  it('settles a bKash payment the same way, keeping the customer reference out of storage', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID', { channel: 'bkash' });
    const fields = gateway.ipnFields(paymentId);

    expect(fields.card_brand).toBe('MOBILE BANKING');

    const res = await sendIpn(fields);

    expect(res.status).toBe(200);
    const state = await stateOf(orderId);
    expect(state.status).toBe('CONFIRMED');
    expect(state.paymentStatus).toBe('PAID');
    expect(await stockOf(variantId)).toBe(9);
    expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(1);

    // For mobile banking `card_no` is the customer's own reference: personal data we do not need.
    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { eventId: { startsWith: paymentId } },
    });
    expect(JSON.stringify(event)).not.toContain(fields.card_no);
  });

  it('stores no card or customer field from the notification', async () => {
    const { paymentId } = await onlineOrder();

    await settleAndNotify(paymentId, 'VALID');

    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { eventId: { startsWith: paymentId } },
    });
    expect(event.status).toBe('PROCESSED');
    expect(event.processedAt).toBeInstanceOf(Date);
    expect(JSON.stringify(event)).not.toContain('411111');
  });
});

describe('duplicate events', () => {
  it('has no second effect from a repeat', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();

    const first = await settleAndNotify(paymentId, 'VALID');
    const fields = gateway.ipnFields(paymentId);
    const queries = gateway.statusQueries;
    const second = await sendIpn(fields);
    const third = await sendIpn(fields);

    expect((first.body as { data: { duplicate: boolean } }).data.duplicate).toBe(false);
    expect(second.status).toBe(200);
    expect((second.body as { data: { duplicate: boolean } }).data.duplicate).toBe(true);
    expect((third.body as { data: { duplicate: boolean } }).data.duplicate).toBe(true);
    // A finished event is recognised without bothering the provider.
    expect(gateway.statusQueries).toBe(queries);

    const state = await stateOf(orderId);
    expect(state.statusHistory.filter((row) => row.toStatus === 'CONFIRMED')).toHaveLength(1);
    expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(1);
    expect(await stockOf(variantId)).toBe(9);

    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { eventId: { startsWith: paymentId } },
    });
    expect(event.attemptCount).toBe(3);
  });

  it('has one effect from many at the same moment', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID');
    const fields = gateway.ipnFields(paymentId);

    const results = await Promise.all(Array.from({ length: 6 }, () => sendIpn(fields)));

    expect(results.every((res) => res.status === 200)).toBe(true);
    const state = await stateOf(orderId);
    expect(state.status).toBe('CONFIRMED');
    expect(state.statusHistory.filter((row) => row.toStatus === 'CONFIRMED')).toHaveLength(1);
    expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(1);
    expect(await stockOf(variantId)).toBe(9);
    expect(await prisma.webhookEvent.count({ where: { eventId: { startsWith: paymentId } } })).toBe(
      1,
    );
  });

  /**
   * Requests fired together may simply not overlap, which would prove nothing. So the test holds
   * the order's row lock itself while they arrive: every one of them is now mid-transaction at the
   * same point when the lock is let go. This is what fails if `applyNews` stops taking the lock.
   */
  async function deliverWhileOrderIsBusy(orderId: string, fields: Record<string, string>) {
    let deliveries: Promise<{ status: number }>[] = [];

    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
        deliveries = Array.from({ length: 4 }, () => sendIpn(fields).then((res) => res));
        await new Promise((resolve) => setTimeout(resolve, 1_500));
      },
      { timeout: 10_000 },
    );

    return Promise.all(deliveries);
  }

  it('takes turns when a success is delivered to a busy order many times over', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID');

    const results = await deliverWhileOrderIsBusy(orderId, gateway.ipnFields(paymentId));

    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    const state = await stateOf(orderId);
    expect(state.status).toBe('CONFIRMED');
    expect(state.statusHistory.filter((row) => row.toStatus === 'CONFIRMED')).toHaveLength(1);
    expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(1);
    expect(await stockOf(variantId)).toBe(9);
  });

  it('takes turns when a failure is delivered to a busy order many times over', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    gateway.settle(paymentId, 'FAILED');

    const results = await deliverWhileOrderIsBusy(orderId, gateway.ipnFields(paymentId));

    expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200]);
    const state = await stateOf(orderId);
    expect(state.statusHistory.filter((row) => row.toStatus === 'PAYMENT_FAILED')).toHaveLength(1);
    expect(await stockOf(variantId)).toBe(10);
    expect(
      await prisma.inventoryMovement.count({ where: { orderId, reason: 'ORDER_CANCELLED' } }),
    ).toBe(1);
  });

  it('releases stock once for many failures at the same moment', async () => {
    const { paymentId, variantId } = await onlineOrder();
    gateway.settle(paymentId, 'FAILED');
    const fields = gateway.ipnFields(paymentId);

    await Promise.all(Array.from({ length: 6 }, () => sendIpn(fields)));

    expect(await stockOf(variantId)).toBe(10);
  });
});

describe('events out of order', () => {
  it('does not let a stale failure undo a success', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    await settleAndNotify(paymentId, 'VALID');

    // An earlier declined attempt, delivered late. The provider's own record still says paid.
    const stale = signFakeIpn({ status: 'FAILED', tran_id: paymentId, val_id: '' }, STORE_PASSWORD);
    const res = await sendIpn(stale);

    expect(res.status).toBe(200);
    const state = await stateOf(orderId);
    expect(state.status).toBe('CONFIRMED');
    expect(state.payments[0]?.status).toBe('SUCCEEDED');
    expect(await stockOf(variantId)).toBe(9);
  });

  it('recovers when a failure arrives before the success that followed it', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();

    // A declined card, then the same customer pays with another: failure is delivered first.
    await settleAndNotify(paymentId, 'FAILED');
    expect(await stockOf(variantId)).toBe(10);

    const res = await settleAndNotify(paymentId, 'VALID');

    expect(res.status).toBe(200);
    const state = await stateOf(orderId);
    expect(state.status).toBe('CONFIRMED');
    expect(state.paymentStatus).toBe('PAID');
    expect(state.payments[0]?.status).toBe('SUCCEEDED');
    expect(await stockOf(variantId)).toBe(9);
    expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(1);
  });
});

describe('a payment that does not complete', () => {
  it.each([
    ['FAILED', 'FAILED'],
    ['CANCELLED', 'CANCELLED'],
    ['EXPIRED', 'FAILED'],
  ] as const)(
    'on %s closes the order, restores stock once and keeps the bag',
    async (status, paymentStatus) => {
      const { orderId, paymentId, variantId } = await onlineOrder();
      expect(await stockOf(variantId)).toBe(9);

      await settleAndNotify(paymentId, status);
      await sendIpn(gateway.ipnFields(paymentId));

      const state = await stateOf(orderId);
      expect(state.status).toBe('PAYMENT_FAILED');
      expect(state.paymentStatus).toBe('FAILED');
      expect(state.payments[0]?.status).toBe(paymentStatus);
      expect(state.payments[0]?.failureCode).toBe(status);
      expect(state.payments[0]?.capturedAt).toBeNull();
      expect(await stockOf(variantId)).toBe(10);
      expect(await bagCount(variantId)).toBe(1);
      expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(0);

      const restores = await prisma.inventoryMovement.count({
        where: { orderId, reason: 'ORDER_CANCELLED' },
      });
      expect(restores).toBe(1);
    },
  );
});

describe('money that arrives after the order closed', () => {
  it('flags it for a person when the goods have since sold', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder(1);
    await settleAndNotify(paymentId, 'FAILED');
    expect(await stockOf(variantId)).toBe(1);

    // Someone else buys the last unit.
    const other = await signUp(app);
    await post(`${API}/checkout`, other)
      .set('idempotency-key', randomUUID())
      .send(placeBody(variantId, { paymentMethod: 'COD' }))
      .expect(201);
    expect(await stockOf(variantId)).toBe(0);

    const res = await settleAndNotify(paymentId, 'VALID');

    expect(res.status).toBe(200);
    const state = await stateOf(orderId);
    // The money is recorded. The order is not revived, and stock did not go negative.
    expect(state.status).toBe('PAYMENT_FAILED');
    expect(state.paymentStatus).toBe('PAID');
    expect(state.payments[0]?.status).toBe('SUCCEEDED');
    expect(await stockOf(variantId)).toBe(0);
    expect(await outboxCount('PAYMENT_REVIEW_REQUIRED', orderId)).toBe(1);
    expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(0);
  });

  it('leaves stock correct for a release after a late re-claim', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    await settleAndNotify(paymentId, 'FAILED');
    await settleAndNotify(paymentId, 'VALID');
    expect(await stockOf(variantId)).toBe(9);

    // What M8's cancellation will do. Checking for "an earlier release" would have leaked the unit.
    const release = () =>
      withTransaction((tx) =>
        releaseStock(tx, [{ variantId, quantity: 1 }], orderId, 'ORDER_CANCELLED'),
      );

    await release();
    expect(await stockOf(variantId)).toBe(10);
    await release();
    expect(await stockOf(variantId)).toBe(10);
  });
});

describe('a success that cannot be trusted', () => {
  it('holds on an amount other than what was charged, and releases nothing', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID', { reportedAmount: '1.00' });

    const res = await sendIpn(gateway.ipnFields(paymentId));

    expect(res.status).toBe(200);
    const state = await stateOf(orderId);
    expect(state.status).toBe('PENDING_PAYMENT');
    expect(state.paymentStatus).toBe('PENDING');
    expect(state.payments[0]?.status).toBe('PROCESSING');
    expect(state.payments[0]?.failureCode).toBe('AMOUNT_MISMATCH');
    expect(state.payments[0]?.capturedAt).toBeNull();
    expect(await outboxCount('PAYMENT_REVIEW_REQUIRED', orderId)).toBe(1);
    expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(0);
    expect(await stockOf(variantId)).toBe(9);
  });

  it('holds a risky payment, and the customer is not sent to pay again', async () => {
    const { orderId, paymentId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID', { riskLevel: 1 });

    await sendIpn(gateway.ipnFields(paymentId));

    const state = await stateOf(orderId);
    expect(state.status).toBe('PENDING_PAYMENT');
    expect(state.payments[0]?.failureCode).toBe('RISK_REVIEW');

    const resume = await startSession(orderId);
    expect(resume.status).toBe(409);
    expect((resume.body as { error: { code: string } }).error.code).toBe('PAYMENT_PENDING');
  });
});

describe('a notification the provider cannot back up', () => {
  it('does not act on a signed success the provider does not confirm', async () => {
    const { orderId, paymentId } = await onlineOrder();
    const fields = signFakeIpn(
      { status: 'VALID', tran_id: paymentId, val_id: 'never-issued' },
      STORE_PASSWORD,
    );

    const res = await sendIpn(fields);

    expect(res.status).toBe(503);
    expect((await stateOf(orderId)).status).toBe('PENDING_PAYMENT');

    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { eventId: { startsWith: paymentId } },
    });
    expect(event.status).toBe('FAILED');
  });

  it('asks for a retry when the provider is unreachable, and the retry settles it', async () => {
    const { orderId, paymentId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID');
    const fields = gateway.ipnFields(paymentId);

    gateway.outage = 'apiDown';
    const during = await sendIpn(fields);

    expect(during.status).toBe(503);
    expect((await stateOf(orderId)).status).toBe('PENDING_PAYMENT');

    gateway.outage = 'none';
    const after = await sendIpn(fields);

    expect(after.status).toBe(200);
    expect((after.body as { data: { duplicate: boolean } }).data.duplicate).toBe(false);
    expect((await stateOf(orderId)).status).toBe('CONFIRMED');
  });

  it('does not leak the store password in the stored error', async () => {
    const { paymentId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID');

    gateway.outage = 'http500';
    await sendIpn(gateway.ipnFields(paymentId));

    const event = await prisma.webhookEvent.findFirstOrThrow({
      where: { eventId: { startsWith: paymentId } },
    });
    expect(event.lastError).toBeTruthy();
    expect(JSON.stringify(event)).not.toContain(STORE_PASSWORD);
  });
});

describe('the browser return', () => {
  const RETURN = `${API}/payments/return`;

  it('is not proof: a forged "success" changes nothing', async () => {
    const { orderId, paymentId } = await onlineOrder();

    const res = await request(app)
      .post(`${RETURN}/${paymentId}`)
      .type('form')
      .send({ status: 'VALID', tran_id: paymentId, val_id: 'forged', amount: '2580.00' });

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`${env.FRONTEND_ORIGIN}/orders/${orderId}?payment=returned`);
    expect((await stateOf(orderId)).status).toBe('PENDING_PAYMENT');
  });

  it('cannot cancel somebody else’s order by forging a failure', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();

    await request(app)
      .post(`${RETURN}/${paymentId}`)
      .type('form')
      .send({ status: 'CANCELLED', tran_id: paymentId })
      .expect(303);

    expect((await stateOf(orderId)).status).toBe('PENDING_PAYMENT');
    expect(await stockOf(variantId)).toBe(9);
  });

  it('settles from what the provider says when the notification has not arrived', async () => {
    const { orderId, paymentId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID');

    await request(app).get(`${RETURN}/${paymentId}`).expect(303);

    expect((await stateOf(orderId)).status).toBe('CONFIRMED');
  });

  it('applies a correctly signed cancellation', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    gateway.settle(paymentId, 'CANCELLED');

    await request(app)
      .post(`${RETURN}/${paymentId}`)
      .type('form')
      .send(gateway.ipnFields(paymentId))
      .expect(303);

    expect((await stateOf(orderId)).status).toBe('PAYMENT_FAILED');
    expect(await stockOf(variantId)).toBe(10);
  });

  it('still sends the customer to their order when the provider is down', async () => {
    const { orderId, paymentId } = await onlineOrder();
    gateway.outage = 'http500';

    const res = await request(app).get(`${RETURN}/${paymentId}`);

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`${env.FRONTEND_ORIGIN}/orders/${orderId}?payment=returned`);
  });

  it('goes nowhere surprising for an id it does not know', async () => {
    const res = await request(app).get(`${RETURN}/does-not-exist`);

    expect(res.status).toBe(303);
    expect(res.headers.location).toBe(`${env.FRONTEND_ORIGIN}/account`);
  });

  it('is rate limited, because each request can call the provider', async () => {
    const limited = createTestApp({ paymentReturn: { windowMs: 60_000, limit: 2 } });

    await request(limited).get(`${RETURN}/x`).expect(303);
    await request(limited).get(`${RETURN}/x`).expect(303);
    await request(limited).get(`${RETURN}/x`).expect(429);
  });
});

describe('reconciliation', () => {
  /** Well past the grace period, inside the window to pay. */
  const shortlyAfter = () => new Date(Date.now() + 10 * 60 * 1000);
  const afterTheWindow = () => new Date(Date.now() + PAYMENT_WINDOW_MS + 60 * 1000);

  /** Earlier tests leave open payments the gateway no longer knows, so each pass starts clean. */
  beforeEach(async () => {
    await prisma.payment.updateMany({
      where: { provider: 'sslcommerz', status: { in: ['PENDING', 'FAILED', 'CANCELLED'] } },
      data: { status: 'CANCELLED', updatedAt: new Date(0) },
    });
  });

  it('settles a payment when the browser closed and no notification ever came', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID');

    const summary = await reconcilePayments({ now: shortlyAfter() });

    expect(summary.settled).toBe(1);
    const state = await stateOf(orderId);
    expect(state.status).toBe('CONFIRMED');
    expect(state.paymentStatus).toBe('PAID');
    expect(await bagCount(variantId)).toBe(0);
    expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(1);
  });

  it('leaves a fresh payment alone: the customer may be on the gateway right now', async () => {
    const { paymentId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID');
    const queries = gateway.statusQueries;

    const summary = await reconcilePayments();

    expect(summary.checked).toBe(0);
    expect(gateway.statusQueries).toBe(queries);
  });

  it('leaves an unpaid order waiting inside the window', async () => {
    const { orderId, variantId } = await onlineOrder();

    const summary = await reconcilePayments({ now: shortlyAfter() });

    expect(summary).toMatchObject({ checked: 1, expired: 0, settled: 0 });
    expect((await stateOf(orderId)).status).toBe('PENDING_PAYMENT');
    expect(await stockOf(variantId)).toBe(9);
  });

  it('closes an abandoned order after the window and puts the goods back on sale', async () => {
    const { orderId, variantId } = await onlineOrder();

    const summary = await reconcilePayments({ now: afterTheWindow() });

    expect(summary.expired).toBe(1);
    const state = await stateOf(orderId);
    expect(state.status).toBe('PAYMENT_FAILED');
    expect(state.payments[0]?.failureCode).toBe('EXPIRED');
    expect(await stockOf(variantId)).toBe(10);
  });

  it('never expires a payment whose status it could not learn', async () => {
    const { orderId, variantId } = await onlineOrder();
    gateway.outage = 'apiDown';

    const summary = await reconcilePayments({ now: afterTheWindow() });

    expect(summary).toMatchObject({ unavailable: 1, expired: 0 });
    expect((await stateOf(orderId)).status).toBe('PENDING_PAYMENT');
    expect(await stockOf(variantId)).toBe(9);
  });

  it('notices money that arrived after it closed the order', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    await reconcilePayments({ now: afterTheWindow() });
    expect(await stockOf(variantId)).toBe(10);

    gateway.settle(paymentId, 'VALID');
    const summary = await reconcilePayments();

    expect(summary.settled).toBe(1);
    expect((await stateOf(orderId)).status).toBe('CONFIRMED');
    expect(await stockOf(variantId)).toBe(9);
  });

  it('can run repeatedly with no further effect', async () => {
    const { orderId, paymentId, variantId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID');

    await reconcilePayments({ now: shortlyAfter() });
    const second = await reconcilePayments({ now: shortlyAfter() });

    expect(second.settled).toBe(0);
    expect(await stockOf(variantId)).toBe(9);
    expect(await outboxCount('ORDER_RECEIPT', orderId)).toBe(1);
  });

  it('does not sweep a payment held for review', async () => {
    const { orderId, paymentId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID', { riskLevel: 1 });
    await sendIpn(gateway.ipnFields(paymentId));

    await reconcilePayments({ now: afterTheWindow() });

    const state = await stateOf(orderId);
    expect(state.status).toBe('PENDING_PAYMENT');
    expect(state.payments[0]?.status).toBe('PROCESSING');
  });
});

describe('reading payment state', () => {
  it('shows the owner a safe view and hides it from anyone else', async () => {
    const { paymentId } = await onlineOrder();
    const stranger = await signUp(app);

    const own = await get(`${API}/payments/${paymentId}`);
    const foreign = await get(`${API}/payments/${paymentId}`, stranger);
    const anonymous = await request(app).get(`${API}/payments/${paymentId}`);

    expect(own.status).toBe(200);
    const body = JSON.stringify(own.body);
    for (const secret of [
      'safeMetadata',
      'gatewayUrl',
      'providerPaymentRef',
      'idempotencyKey',
      'failureCode',
    ]) {
      expect(body).not.toContain(secret);
    }
    expect(foreign.status).toBe(404);
    expect(anonymous.status).toBe(401);
  });

  it('shows an administrator why a payment is held, and never a customer', async () => {
    const { paymentId } = await onlineOrder();
    gateway.settle(paymentId, 'VALID', { riskLevel: 1 });
    await sendIpn(gateway.ipnFields(paymentId));
    const admin = await signUpAs(app, UserRole.ADMIN);

    const asAdmin = await get(`${API}/payments/${paymentId}`, admin);
    const asOwner = await get(`${API}/payments/${paymentId}`);

    expect((asAdmin.body as { data: { failureCode: string } }).data.failureCode).toBe(
      'RISK_REVIEW',
    );
    expect(JSON.stringify(asOwner.body)).not.toContain('RISK_REVIEW');
  });

  it('keeps gateway details out of the order, and says when payment can be resumed', async () => {
    const { orderId, paymentId } = await onlineOrder();

    const waiting = await get(`${API}/orders/${orderId}`);
    expect(
      (waiting.body as { data: { payment: { canResume: boolean } } }).data.payment.canResume,
    ).toBe(true);
    expect(JSON.stringify(waiting.body)).not.toContain('gatewayUrl');

    await settleAndNotify(paymentId, 'VALID');

    const settled = await get(`${API}/orders/${orderId}`);
    const { data } = settled.body as {
      data: { paymentStatus: string; payment: { status: string; canResume: boolean } };
    };
    expect(data.paymentStatus).toBe('PAID');
    expect(data.payment).toMatchObject({ status: 'SUCCEEDED', canResume: false });
  });

  it('has no online payment on a cash-on-delivery order', async () => {
    const variant = await makeVariant();
    const res = await post(`${API}/checkout`)
      .set('idempotency-key', randomUUID())
      .send(placeBody(variant.id, { paymentMethod: 'COD' }));

    expect((res.body as { data: { payment: unknown; status: string } }).data).toMatchObject({
      payment: null,
      status: 'CONFIRMED',
    });
  });
});
