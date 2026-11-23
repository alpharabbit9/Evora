import { randomUUID } from 'node:crypto';

import { UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FakeSslcommerz } from '../../scripts/payments/fake-sslcommerz.js';
import { prisma } from '../../src/lib/prisma.js';
import { deliveryFeeMinor } from '../../src/modules/pricing/pricing.js';
import { reconcilePayments } from '../../src/modules/payments/payments.service.js';
import { reconcileRefunds } from '../../src/modules/refunds/refunds.service.js';
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
 * M8 (ADR 0020): cancellation, fulfilment, cash collection, refunds and held payments, through the
 * real app, the real SSLCOMMERZ adapter and PostgreSQL, with a local gateway stand-in. Each test
 * names the failure it guards against (implementation-plan.md M8, PRD §7).
 */
const app = createTestApp();

const WEBHOOK = `${API}/webhooks/payments/sslcommerz`;
const FEE = deliveryFeeMinor('standard', { city: 'Dhaka', countryCode: 'BD' });
const PRICE = 250_000;
const TOTAL = PRICE + FEE;
/** Past the refund sweep's grace period. */
const later = () => new Date(Date.now() + 10 * 60 * 1000);

const gateway = new FakeSslcommerz({
  storeId: process.env.SSLCOMMERZ_STORE_ID ?? '',
  storePassword: process.env.SSLCOMMERZ_STORE_PASSWORD ?? '',
  port: 4599,
});

let customer: TestSession;
let admin: TestSession;
let categoryId: string;

beforeAll(async () => {
  await truncateAll();
  await gateway.start();
  customer = await signUp(app);
  admin = await signUpAs(app, UserRole.ADMIN);
  categoryId = (await makeCategory('m8-shoes')).id;
});

afterAll(async () => {
  await gateway.stop();
  await prisma.$disconnect();
});

beforeEach(() => {
  gateway.reset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeVariant(stockQuantity = 10) {
  const { variants } = await makeProduct({
    categoryId,
    name: 'M8 Shoe',
    variants: [{ size: 'M', priceMinor: PRICE, stockQuantity, lowStockThreshold: 0 }],
  });
  const variant = variants[0];
  if (!variant) throw new Error('fixture has no variant');
  return variant;
}

function post(path: string, session: TestSession = customer) {
  return request(app).post(path).set('origin', ORIGIN).set('cookie', session.cookie);
}

function get(path: string, session: TestSession = customer) {
  return request(app).get(path).set('cookie', session.cookie);
}

async function placeOrder(method: 'COD' | 'ONLINE', stock = 10) {
  const variant = await makeVariant(stock);
  const res = await post(`${API}/checkout`)
    .set('idempotency-key', randomUUID())
    .send({
      items: [{ variantId: variant.id, quantity: 1 }],
      shipping: {
        recipientName: 'Test Person',
        phone: '+880 1700-000000',
        line1: '1 Test Road',
        city: 'Dhaka',
        postalCode: '1207',
        countryCode: 'BD',
      },
      deliveryOption: 'standard',
      paymentMethod: method,
      expectedTotalMinor: TOTAL,
    });

  expect(res.status).toBe(201);
  const orderId = (res.body as { data: { id: string } }).data.id;
  const payment = await prisma.payment.findFirstOrThrow({ where: { orderId } });

  return { orderId, paymentId: payment.id, variantId: variant.id };
}

async function onlineOrderWithSession() {
  const order = await placeOrder('ONLINE');
  expect((await post(`${API}/orders/${order.orderId}/payment-session`).send()).status).toBe(200);
  return order;
}

function sendIpn(paymentId: string) {
  return request(app).post(WEBHOOK).type('form').send(gateway.ipnFields(paymentId));
}

/** An online order the customer has paid for, confirmed through the webhook. */
async function paidOnlineOrder(options: { riskLevel?: number; reportedAmount?: string } = {}) {
  const order = await onlineOrderWithSession();
  gateway.settle(order.paymentId, 'VALID', options);
  expect((await sendIpn(order.paymentId)).status).toBe(200);
  return order;
}

function cancel(orderId: string, session: TestSession = customer, body: object = {}) {
  return post(`${API}/orders/${orderId}/cancel`, session).send(body);
}

function transition(orderId: string, body: object, session: TestSession = admin) {
  return post(`${API}/admin/orders/${orderId}/transitions`, session).send(body);
}

function refund(orderId: string, body: object, key: string = randomUUID()) {
  return post(`${API}/admin/orders/${orderId}/refunds`, admin)
    .set('idempotency-key', key)
    .send(body);
}

async function stateOf(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      status: true,
      paymentStatus: true,
      shippingCarrier: true,
      trackingNumber: true,
      statusHistory: {
        orderBy: { createdAt: 'asc' },
        select: { fromStatus: true, toStatus: true },
      },
      payments: { select: { status: true, failureCode: true, capturedAt: true } },
      refunds: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, status: true, amountMinor: true, providerRefundRef: true },
      },
    },
  });
}

async function stockOf(variantId: string) {
  return (
    await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantId },
      select: { stockQuantity: true },
    })
  ).stockQuantity;
}

function outbox(
  eventType: 'ORDER_CANCELLED' | 'REFUND_UPDATE' | 'SHIPPING_UPDATE' | 'PAYMENT_REVIEW_REQUIRED',
  orderId: string,
) {
  return prisma.outboxEvent.count({
    where: { eventType, payload: { path: ['orderId'], equals: orderId } },
  });
}

function reviewReasons(orderId: string) {
  return prisma.outboxEvent
    .findMany({
      where: {
        eventType: 'PAYMENT_REVIEW_REQUIRED',
        payload: { path: ['orderId'], equals: orderId },
      },
      select: { payload: true },
    })
    .then((rows) => rows.map((row) => (row.payload as { reason: string }).reason).sort());
}

function audits(entityId: string, action: string) {
  return prisma.auditLog.count({ where: { entityId, action } });
}

// ---------------------------------------------------------------------------
// Customer cancellation
// ---------------------------------------------------------------------------

describe('a customer cancelling', () => {
  it('closes a cash-on-delivery order, puts the goods back once, and is safe to repeat', async () => {
    const { orderId, variantId } = await placeOrder('COD');
    expect(await stockOf(variantId)).toBe(9);

    const first = await cancel(orderId, customer, { reason: 'Ordered the wrong size' });
    const second = await cancel(orderId);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const { data } = first.body as {
      data: { status: string; canCancel: boolean; paymentStatus: string };
    };
    expect(data).toMatchObject({ status: 'CANCELLED', canCancel: false, paymentStatus: 'UNPAID' });

    const state = await stateOf(orderId);
    expect(state.payments[0]?.status).toBe('CANCELLED');
    expect(state.statusHistory.filter((row) => row.toStatus === 'CANCELLED')).toHaveLength(1);
    expect(state.refunds).toHaveLength(0);
    expect(await stockOf(variantId)).toBe(10);
    expect(await outbox('ORDER_CANCELLED', orderId)).toBe(1);
  });

  it('is refused for another customer’s order, without a session and from another site', async () => {
    const { orderId } = await placeOrder('COD');
    const stranger = await signUp(app);

    expect((await cancel(orderId, stranger)).status).toBe(404);
    expect(
      (await request(app).post(`${API}/orders/${orderId}/cancel`).set('origin', ORIGIN)).status,
    ).toBe(401);
    expect(
      (
        await request(app)
          .post(`${API}/orders/${orderId}/cancel`)
          .set('origin', 'https://evil.example')
          .set('cookie', customer.cookie)
      ).status,
    ).toBe(403);
    expect((await stateOf(orderId)).status).toBe('CONFIRMED');
  });

  it('is refused once the store is preparing the order', async () => {
    const { orderId, variantId } = await placeOrder('COD');
    await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }).expect(200);

    const res = await cancel(orderId);

    expect(res.status).toBe(409);
    expect((await stateOf(orderId)).status).toBe('PROCESSING');
    expect(await stockOf(variantId)).toBe(9);
  });

  it('does not accept a status or amount in the body', async () => {
    const { orderId } = await placeOrder('COD');

    expect((await cancel(orderId, customer, { status: 'DELIVERED' })).status).toBe(400);
  });

  it('refunds a paid online order in full, once, and records the refund when the bank completes it', async () => {
    const { orderId, paymentId, variantId } = await paidOnlineOrder();
    expect(await stockOf(variantId)).toBe(9);

    const res = await cancel(orderId);

    expect(res.status).toBe(200);
    let state = await stateOf(orderId);
    expect(state.status).toBe('CANCELLED');
    expect(state.refunds).toHaveLength(1);
    expect(state.refunds[0]).toMatchObject({ status: 'PENDING', amountMinor: TOTAL });
    expect(state.refunds[0]?.providerRefundRef).toBeTruthy();
    expect(gateway.refundRequests).toBe(1);
    expect(await stockOf(variantId)).toBe(10);

    gateway.settleRefunds();
    const summary = await reconcileRefunds({ now: later() });
    const again = await reconcileRefunds({ now: later() });

    expect(summary.completed).toBe(1);
    expect(again.completed).toBe(0);
    state = await stateOf(orderId);
    expect(state.refunds[0]?.status).toBe('SUCCEEDED');
    expect(state.payments[0]?.status).toBe('REFUNDED');
    expect(state.paymentStatus).toBe('REFUNDED');
    expect(gateway.refundedMinorFor(paymentId)).toBe(TOTAL);
    expect(await outbox('REFUND_UPDATE', orderId)).toBe(2);

    const view = await get(`${API}/orders/${orderId}`);
    expect((view.body as { data: { refunds: { status: string }[] } }).data.refunds).toEqual([
      expect.objectContaining({ status: 'SUCCEEDED', amountMinor: TOTAL }),
    ]);
  });

  it('cancels an unpaid online order and stops the payment', async () => {
    const { orderId, variantId } = await onlineOrderWithSession();

    await cancel(orderId).expect(200);

    const state = await stateOf(orderId);
    expect(state.status).toBe('CANCELLED');
    expect(state.paymentStatus).toBe('UNPAID');
    expect(state.payments[0]).toMatchObject({
      status: 'CANCELLED',
      failureCode: 'ORDER_CANCELLED',
    });
    expect(await stockOf(variantId)).toBe(10);
  });

  it('notices a payment made seconds before cancelling, and refunds it rather than losing it', async () => {
    const { orderId, paymentId } = await onlineOrderWithSession();
    // The customer paid, but the notification has not arrived yet.
    gateway.settle(paymentId, 'VALID');

    await cancel(orderId).expect(200);

    const state = await stateOf(orderId);
    expect(state.status).toBe('CANCELLED');
    expect(state.payments[0]?.status).toBe('SUCCEEDED');
    expect(state.refunds[0]).toMatchObject({ amountMinor: TOTAL, status: 'PENDING' });
    expect(gateway.refundRequests).toBe(1);
  });

  it('flags money that arrives after cancelling, for a person to refund', async () => {
    const { orderId, paymentId, variantId } = await onlineOrderWithSession();
    gateway.outage = 'apiDown';
    await cancel(orderId).expect(200);
    gateway.outage = 'none';

    gateway.settle(paymentId, 'VALID');
    await reconcilePayments({ now: later() });

    const state = await stateOf(orderId);
    expect(state.status).toBe('CANCELLED');
    expect(state.paymentStatus).toBe('PAID');
    expect(await reviewReasons(orderId)).toContain('PAID_AFTER_CLOSE');
    expect(await stockOf(variantId)).toBe(10);

    // The flag is actionable: the money can now be refunded.
    const res = await refund(orderId, { amountMinor: TOTAL, reason: 'Paid after cancelling' });
    expect(res.status).toBe(201);
  });

  it('waits while a payment is held for review', async () => {
    const { orderId } = await paidOnlineOrder({ riskLevel: 1 });

    const view = await get(`${API}/orders/${orderId}`);
    const res = await cancel(orderId);

    expect((view.body as { data: { canCancel: boolean } }).data.canCancel).toBe(false);
    expect(res.status).toBe(409);
    expect((res.body as { error: { code: string } }).error.code).toBe('PAYMENT_PENDING');
  });
});

// ---------------------------------------------------------------------------
// Fulfilment
// ---------------------------------------------------------------------------

describe('fulfilment', () => {
  it('moves an order forward, records tracking, audits each step, and shows the customer', async () => {
    const { orderId } = await placeOrder('COD');

    await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }).expect(200);
    const shipped = await transition(orderId, {
      from: 'PROCESSING',
      to: 'SHIPPED',
      carrier: 'Pathao',
      trackingNumber: 'PTH-123456',
    });
    await transition(orderId, { from: 'SHIPPED', to: 'DELIVERED' }).expect(200);

    expect(shipped.status).toBe(200);
    const state = await stateOf(orderId);
    expect(state.status).toBe('DELIVERED');
    expect(state).toMatchObject({ shippingCarrier: 'Pathao', trackingNumber: 'PTH-123456' });
    expect(await audits(orderId, 'order.transitioned')).toBe(3);
    expect(await outbox('SHIPPING_UPDATE', orderId)).toBe(2);

    const view = await get(`${API}/orders/${orderId}`);
    const { data } = view.body as {
      data: { timeline: { status: string }[]; tracking: object; canCancel: boolean };
    };
    expect(data.timeline.map((entry) => entry.status)).toEqual([
      'CONFIRMED',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
    ]);
    expect(data.tracking).toEqual({ carrier: 'Pathao', number: 'PTH-123456' });
    expect(data.canCancel).toBe(false);
    // Who moved it, and any internal note, are not the customer's to see.
    expect(JSON.stringify(view.body)).not.toContain(admin.email);
  });

  it('refuses a skipped or backward step, and a confirmation by hand', async () => {
    const { orderId } = await placeOrder('COD');

    expect((await transition(orderId, { from: 'CONFIRMED', to: 'DELIVERED' })).status).toBe(400);
    expect((await transition(orderId, { from: 'CONFIRMED', to: 'CONFIRMED' })).status).toBe(400);

    const waiting = await onlineOrderWithSession();
    expect(
      (await transition(waiting.orderId, { from: 'PENDING_PAYMENT', to: 'CONFIRMED' })).status,
    ).toBe(400);
    expect((await stateOf(waiting.orderId)).status).toBe('PENDING_PAYMENT');
  });

  it('refuses a change to an order that moved since it was looked at', async () => {
    const { orderId } = await placeOrder('COD');
    await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }).expect(200);

    const stale = await transition(orderId, { from: 'CONFIRMED', to: 'CANCELLED' });

    expect(stale.status).toBe(409);
    expect((await stateOf(orderId)).status).toBe('PROCESSING');
  });

  it('treats a repeated step as done, with no second history entry', async () => {
    const { orderId } = await placeOrder('COD');

    await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }).expect(200);
    await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }).expect(200);

    const state = await stateOf(orderId);
    expect(state.statusHistory.filter((row) => row.toStatus === 'PROCESSING')).toHaveLength(1);
    expect(await audits(orderId, 'order.transitioned')).toBe(1);
  });

  it('lets exactly one of two admins win when they act at once', async () => {
    const { orderId, variantId } = await placeOrder('COD');
    await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }).expect(200);

    const results = await Promise.all([
      transition(orderId, { from: 'PROCESSING', to: 'SHIPPED' }),
      transition(orderId, { from: 'PROCESSING', to: 'CANCELLED' }),
    ]);

    expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
    const state = await stateOf(orderId);
    expect(['SHIPPED', 'CANCELLED']).toContain(state.status);
    expect(await stockOf(variantId)).toBe(state.status === 'CANCELLED' ? 10 : 9);
  });

  it('keeps tracking details for shipping only', async () => {
    const { orderId } = await placeOrder('COD');

    const res = await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING', carrier: 'X' });

    expect(res.status).toBe(400);
  });

  it('refunds a paid order the store cancels while preparing it', async () => {
    const { orderId, variantId } = await paidOnlineOrder();
    await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }).expect(200);

    await transition(orderId, {
      from: 'PROCESSING',
      to: 'CANCELLED',
      note: 'Damaged in the warehouse',
    }).expect(200);

    const state = await stateOf(orderId);
    expect(state.status).toBe('CANCELLED');
    expect(state.refunds[0]).toMatchObject({ amountMinor: TOTAL });
    expect(await stockOf(variantId)).toBe(10);
  });

  it('is for administrators only', async () => {
    const { orderId } = await placeOrder('COD');

    expect(
      (await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }, customer)).status,
    ).toBe(403);
    expect((await get(`${API}/admin/orders`)).status).toBe(403);
    expect(
      (await refund(orderId, { amountMinor: 1, reason: 'x' }).set('cookie', customer.cookie))
        .status,
    ).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Cash on delivery
// ---------------------------------------------------------------------------

describe('cash on delivery', () => {
  it('records cash only once it has shipped, once, and audited', async () => {
    const { orderId } = await placeOrder('COD');
    const collect = () => post(`${API}/admin/orders/${orderId}/cod-collection`, admin).send();

    expect((await collect()).status).toBe(409);

    await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }).expect(200);
    await transition(orderId, { from: 'PROCESSING', to: 'SHIPPED' }).expect(200);
    await collect().expect(200);
    await collect().expect(200);

    const state = await stateOf(orderId);
    expect(state.paymentStatus).toBe('COD_COLLECTED');
    expect(state.payments[0]?.status).toBe('SUCCEEDED');
    expect(state.payments[0]?.capturedAt).toBeInstanceOf(Date);
    expect(await audits(orderId, 'order.cod.collected')).toBe(1);
  });

  it('refuses to record cash for an online order', async () => {
    const { orderId } = await paidOnlineOrder();

    expect((await post(`${API}/admin/orders/${orderId}/cod-collection`, admin).send()).status).toBe(
      409,
    );
  });

  it('refunds collected cash by hand, without the provider, and nothing before it is collected', async () => {
    const { orderId } = await placeOrder('COD');

    expect((await refund(orderId, { amountMinor: 1000, reason: 'Goodwill' })).status).toBe(409);

    await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }).expect(200);
    await transition(orderId, { from: 'PROCESSING', to: 'SHIPPED' }).expect(200);
    await transition(orderId, { from: 'SHIPPED', to: 'DELIVERED' }).expect(200);
    await post(`${API}/admin/orders/${orderId}/cod-collection`, admin).send().expect(200);

    const res = await refund(orderId, { amountMinor: 50_000, reason: 'One item faulty' });

    expect(res.status).toBe(201);
    expect((res.body as { data: { status: string } }).data.status).toBe('SUCCEEDED');
    expect(gateway.refundRequests).toBe(0);
    const state = await stateOf(orderId);
    expect(state.payments[0]?.status).toBe('PARTIALLY_REFUNDED');
    expect(state.paymentStatus).toBe('PARTIALLY_REFUNDED');
  });
});

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

describe('refunds', () => {
  it('allows partial refunds up to what was paid, and no further', async () => {
    const { orderId, paymentId } = await paidOnlineOrder();

    const part = await refund(orderId, { amountMinor: 100_000, reason: 'Late delivery' });
    const rest = await refund(orderId, { amountMinor: TOTAL - 100_000, reason: 'Returned' });
    const tooMuch = await refund(orderId, { amountMinor: 1, reason: 'One more' });

    expect(part.status).toBe(201);
    expect(rest.status).toBe(201);
    expect(tooMuch.status).toBe(409);
    expect(gateway.refundedMinorFor(paymentId)).toBe(TOTAL);
    expect(await audits(orderId, 'refund.requested')).toBe(2);

    gateway.settleRefunds();
    await reconcileRefunds({ now: later() });
    const state = await stateOf(orderId);
    expect(state.payments[0]?.status).toBe('REFUNDED');
  });

  it('marks a payment partly refunded until the whole amount is back', async () => {
    const { orderId } = await paidOnlineOrder();

    await refund(orderId, { amountMinor: 100_000, reason: 'Late delivery' }).expect(201);
    gateway.settleRefunds();
    await reconcileRefunds({ now: later() });

    const state = await stateOf(orderId);
    expect(state.payments[0]?.status).toBe('PARTIALLY_REFUNDED');
    expect(state.paymentStatus).toBe('PARTIALLY_REFUNDED');
  });

  it('replays a repeated request instead of refunding twice, and refuses the key reused for another amount', async () => {
    const { orderId, paymentId } = await paidOnlineOrder();
    const key = randomUUID();
    const body = { amountMinor: 100_000, reason: 'Late delivery' };

    const first = await refund(orderId, body, key);
    const second = await refund(orderId, body, key);
    const changed = await refund(orderId, { ...body, amountMinor: 50_000 }, key);
    const keyless = await post(`${API}/admin/orders/${orderId}/refunds`, admin).send(body);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect((second.body as { meta: { replayed: boolean } }).meta.replayed).toBe(true);
    expect((second.body as { data: { id: string } }).data.id).toBe(
      (first.body as { data: { id: string } }).data.id,
    );
    expect(changed.status).toBe(409);
    expect((changed.body as { error: { code: string } }).error.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(keyless.status).toBe(400);
    expect(gateway.refundRequests).toBe(1);
    expect(gateway.refundedMinorFor(paymentId)).toBe(100_000);
  });

  it('never refunds more than was paid, however many requests arrive at once', async () => {
    const { orderId, paymentId } = await paidOnlineOrder();

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        refund(orderId, { amountMinor: TOTAL, reason: 'Duplicate click' }),
      ),
    );

    expect(results.map((res) => res.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect((await stateOf(orderId)).refunds).toHaveLength(1);
    expect(gateway.refundedMinorFor(paymentId)).toBe(TOTAL);
  });

  it('does not refund twice when the provider’s answer is lost', async () => {
    const { orderId, paymentId } = await paidOnlineOrder();

    gateway.refundMode = 'loseResponse';
    const res = await refund(orderId, { amountMinor: TOTAL, reason: 'Returned' });

    expect(res.status).toBe(201);
    expect(
      (res.body as { data: { providerAcknowledged: boolean } }).data.providerAcknowledged,
    ).toBe(false);
    expect(gateway.refunds.size).toBe(1);

    // The sweep asks again with the same id; the provider says it already has it.
    gateway.refundMode = 'normal';
    await reconcileRefunds({ now: later() });
    await reconcileRefunds({ now: later() });

    expect(gateway.refunds.size).toBe(1);
    expect(gateway.refundRequests).toBe(2);
    expect(gateway.refundedMinorFor(paymentId)).toBe(TOTAL);
    expect(await reviewReasons(orderId)).toContain('REFUND_UNCONFIRMED');
    expect((await stateOf(orderId)).refunds[0]?.status).toBe('PENDING');
  });

  it('sends a refund later when the provider was unreachable, and completes it', async () => {
    const { orderId, paymentId } = await paidOnlineOrder();

    gateway.outage = 'apiDown';
    const res = await refund(orderId, { amountMinor: TOTAL, reason: 'Returned' });
    expect(res.status).toBe(201);
    expect(gateway.refunds.size).toBe(0);

    gateway.outage = 'none';
    const sent = await reconcileRefunds({ now: later() });
    gateway.settleRefunds();
    const done = await reconcileRefunds({ now: later() });

    expect(sent.sent).toBe(1);
    expect(done.completed).toBe(1);
    expect(gateway.refundedMinorFor(paymentId)).toBe(TOTAL);
    expect((await stateOf(orderId)).payments[0]?.status).toBe('REFUNDED');
  });

  it('records a refused refund as failed, flags it, and frees the amount', async () => {
    const { orderId } = await paidOnlineOrder();

    gateway.refundMode = 'refuse';
    const res = await refund(orderId, { amountMinor: TOTAL, reason: 'Returned' });

    expect((res.body as { data: { status: string } }).data.status).toBe('FAILED');
    expect(await reviewReasons(orderId)).toContain('REFUND_FAILED');

    gateway.refundMode = 'normal';
    expect((await refund(orderId, { amountMinor: TOTAL, reason: 'Returned' })).status).toBe(201);
  });

  it('records a completed refund once when two sweeps run at the same moment', async () => {
    const { orderId } = await paidOnlineOrder();
    await refund(orderId, { amountMinor: TOTAL, reason: 'Returned' }).expect(201);
    gateway.settleRefunds();

    const sweeps = await Promise.all([
      reconcileRefunds({ now: later() }),
      reconcileRefunds({ now: later() }),
      reconcileRefunds({ now: later() }),
    ]);

    expect(sweeps.reduce((sum, sweep) => sum + sweep.completed, 0)).toBe(1);
    const state = await stateOf(orderId);
    expect(state.refunds[0]?.status).toBe('SUCCEEDED');
    expect(state.payments[0]?.status).toBe('REFUNDED');
  });

  it('records a refund the bank abandons as failed', async () => {
    const { orderId } = await paidOnlineOrder();

    await refund(orderId, { amountMinor: TOTAL, reason: 'Returned' }).expect(201);
    gateway.settleRefunds('cancelled');
    await reconcileRefunds({ now: later() });

    const state = await stateOf(orderId);
    expect(state.refunds[0]?.status).toBe('FAILED');
    expect(state.payments[0]?.status).toBe('SUCCEEDED');
  });

  it('has nothing to refund on an order that was never paid', async () => {
    const { orderId } = await onlineOrderWithSession();

    const res = await refund(orderId, { amountMinor: 1000, reason: 'x' });

    expect(res.status).toBe(409);
    expect(gateway.refundRequests).toBe(0);
  });

  it('refuses a non-positive amount', async () => {
    const { orderId } = await paidOnlineOrder();

    expect((await refund(orderId, { amountMinor: 0, reason: 'x' })).status).toBe(400);
    expect((await refund(orderId, { amountMinor: -5, reason: 'x' })).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Held payments
// ---------------------------------------------------------------------------

describe('held payments', () => {
  function resolve(paymentId: string, body: object) {
    return post(`${API}/admin/payments/${paymentId}/hold-resolution`, admin).send(body);
  }

  it('completes a risk hold a person accepts', async () => {
    const { orderId, paymentId, variantId } = await paidOnlineOrder({ riskLevel: 1 });

    const res = await resolve(paymentId, { decision: 'accept', note: 'Called the customer' });

    expect(res.status).toBe(200);
    const state = await stateOf(orderId);
    expect(state.status).toBe('CONFIRMED');
    expect(state.paymentStatus).toBe('PAID');
    expect(await stockOf(variantId)).toBe(9);
    expect(await audits(paymentId, 'payment.hold.resolved')).toBe(1);
  });

  it('cancels and refunds a risk hold a person rejects', async () => {
    const { orderId, paymentId, variantId } = await paidOnlineOrder({ riskLevel: 1 });

    await resolve(paymentId, { decision: 'reject', note: 'Card reported stolen' }).expect(200);

    const state = await stateOf(orderId);
    expect(state.status).toBe('CANCELLED');
    expect(state.refunds[0]).toMatchObject({ amountMinor: TOTAL });
    expect(gateway.refundedMinorFor(paymentId)).toBe(TOTAL);
    expect(await stockOf(variantId)).toBe(10);
  });

  it('never accepts a payment for the wrong amount, and leaves its refund to a person', async () => {
    const { orderId, paymentId, variantId } = await paidOnlineOrder({ reportedAmount: '1.00' });

    expect((await resolve(paymentId, { decision: 'accept', note: 'ok' })).status).toBe(409);

    await resolve(paymentId, { decision: 'reject', note: 'Underpaid' }).expect(200);

    const state = await stateOf(orderId);
    expect(state.status).toBe('CANCELLED');
    expect(state.refunds).toHaveLength(0);
    expect(gateway.refundRequests).toBe(0);
    expect(await reviewReasons(orderId)).toContain('CANCELLED_WHILE_HELD');
    expect(await stockOf(variantId)).toBe(10);
  });

  it('refuses to resolve a payment that is not held', async () => {
    const { paymentId } = await paidOnlineOrder();

    expect((await resolve(paymentId, { decision: 'accept', note: 'x' })).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Admin reads
// ---------------------------------------------------------------------------

describe('admin order list and detail', () => {
  it('filters by status and finds an order by number', async () => {
    const { orderId } = await placeOrder('COD');
    await transition(orderId, { from: 'CONFIRMED', to: 'PROCESSING' }).expect(200);
    const { orderNumber } = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { orderNumber: true },
    });

    const byStatus = await get(`${API}/admin/orders?status=PROCESSING`, admin);
    const byNumber = await get(`${API}/admin/orders?q=${orderNumber.toLowerCase()}`, admin);

    const statuses = (byStatus.body as { data: { status: string }[] }).data.map(
      (row) => row.status,
    );
    expect(new Set(statuses)).toEqual(new Set(['PROCESSING']));
    expect((byNumber.body as { data: { id: string }[] }).data.map((row) => row.id)).toEqual([
      orderId,
    ]);
  });

  it('shows who did what, why a payment is held, and what can happen next', async () => {
    const { orderId } = await paidOnlineOrder({ riskLevel: 1 });

    const res = await get(`${API}/admin/orders/${orderId}`, admin);

    const { data } = res.body as {
      data: {
        allowedTransitions: string[];
        payments: { failureCode: string }[];
        history: { toStatus: string }[];
      };
    };
    expect(data.allowedTransitions).toEqual(['CANCELLED']);
    expect(data.payments[0]?.failureCode).toBe('RISK_REVIEW');
    expect(data.history.map((row) => row.toStatus)).toEqual(['PENDING_PAYMENT']);
  });
});
