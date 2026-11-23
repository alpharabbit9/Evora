import { randomUUID } from 'node:crypto';

import { type OutboxEventType, type OutboxStatus, type Prisma, UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import { MAX_ATTEMPTS, RECONCILIATION_DEDUPE_KEY } from '../../src/modules/jobs/job-policy.js';
import type { JobHandler } from '../../src/modules/jobs/job-types.js';
import {
  claimDueJobs,
  completeJob,
  ensureRecurringJobs,
  failJob,
} from '../../src/modules/jobs/outbox.store.js';
import { DEFAULT_HANDLERS, runDueJobs } from '../../src/modules/jobs/worker.js';
import { deliveryFeeMinor } from '../../src/modules/pricing/pricing.js';
import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailTransport,
} from '../../src/modules/notifications/transport.js';
import { makeCategory, makeProduct } from './catalog-fixtures.js';
import {
  API,
  AUTH,
  ORIGIN,
  type TestSession,
  createTestApp,
  makeOrder,
  signUp,
  signUpAs,
  truncateAll,
} from './harness.js';

/**
 * M9 (ADR 0021): the outbox worker and the admin job endpoints, against PostgreSQL. The worker is
 * driven one batch at a time with a recording transport and an injected clock, so retries,
 * leases and give-ups are checked without waiting for them.
 */
const app = createTestApp();
const INTERVAL = 5 * 60 * 1000;

class RecordingTransport implements EmailTransport {
  readonly name = 'recording';
  sent: EmailMessage[] = [];
  failure: Error | null = null;

  send(message: EmailMessage): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    this.sent.push(message);
    return Promise.resolve();
  }
}

const transport = new RecordingTransport();
let clock = new Date();

function deps(handlers?: Record<OutboxEventType, JobHandler>) {
  return {
    transport,
    now: () => clock,
    random: () => 0.5,
    recurringIntervalMs: INTERVAL,
    ...(handlers ? { handlers } : {}),
  };
}

const minutes = (count: number) => new Date(clock.getTime() + count * 60 * 1000);

let customer: TestSession;
let admin: TestSession;
let categoryId: string;

beforeAll(async () => {
  await truncateAll();
  customer = await signUp(app, { name: 'Jobs Customer' });
  admin = await signUpAs(app, UserRole.ADMIN);
  categoryId = (await makeCategory('m9-shoes')).id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await prisma.outboxEvent.deleteMany();
  transport.sent = [];
  transport.failure = null;
  clock = new Date();
});

async function queue(
  eventType: OutboxEventType,
  payload: Prisma.InputJsonValue,
  extra: Partial<Prisma.OutboxEventUncheckedCreateInput> = {},
) {
  return prisma.outboxEvent.create({
    data: {
      eventType,
      dedupeKey: `${eventType}:${randomUUID()}`,
      payload,
      nextAttemptAt: new Date(clock.getTime() - 1000),
      ...extra,
    },
  });
}

function job(id: string) {
  return prisma.outboxEvent.findUniqueOrThrow({ where: { id } });
}

function get(path: string, session: TestSession = admin) {
  return request(app).get(`${API}${path}`).set('cookie', session.cookie);
}

function post(path: string, body: object = {}, session: TestSession = admin) {
  return request(app)
    .post(`${API}${path}`)
    .set('origin', ORIGIN)
    .set('cookie', session.cookie)
    .send(body);
}

async function customerOrder() {
  const order = await makeOrder(customer.userId);
  return prisma.order.findUniqueOrThrow({ where: { id: order.id } });
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

describe('sending', () => {
  it('sends a queued receipt once, to the order contact, and records it', async () => {
    const order = await customerOrder();
    const row = await queue('ORDER_RECEIPT', { orderId: order.id, orderNumber: order.orderNumber });

    const first = await runDueJobs(deps());
    expect(first).toMatchObject({ claimed: 1, sent: 1 });
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.to).toEqual([order.contactEmail]);
    expect(transport.sent[0]?.subject).toContain(order.orderNumber);
    expect(transport.sent[0]?.text).toContain(`/orders/${order.id}`);
    expect(transport.sent[0]?.idempotencyKey).toBe(row.dedupeKey);

    const done = await job(row.id);
    expect(done).toMatchObject({
      status: 'SENT',
      attemptCount: 1,
      claimToken: null,
      lastError: null,
    });
    expect(done.processedAt).not.toBeNull();

    // Nothing is due any more: a second poll sends nothing.
    expect((await runDueJobs(deps())).claimed).toBe(0);
    expect(transport.sent).toHaveLength(1);
  });

  it('does not send a receipt for an order that closed first, and says why', async () => {
    const order = await customerOrder();
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    const row = await queue('ORDER_RECEIPT', { orderId: order.id });

    expect(await runDueJobs(deps())).toMatchObject({ claimed: 1, skipped: 1 });
    expect(transport.sent).toHaveLength(0);
    expect(await job(row.id)).toMatchObject({
      status: 'SENT',
      lastError: 'Not sent: The order closed before its receipt was sent',
    });
  });

  it('sends shipping, cancellation and refund messages with what the order says now', async () => {
    const order = await customerOrder();
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'SHIPPED', shippingCarrier: 'Pathao', trackingNumber: 'PTH-123' },
    });
    await queue('SHIPPING_UPDATE', { orderId: order.id, status: 'SHIPPED' });

    await runDueJobs(deps());
    expect(transport.sent[0]?.text).toContain('PTH-123');
    expect(transport.sent[0]?.subject).toContain('on its way');

    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'cod',
        method: 'COD',
        amountMinor: 1000,
        currency: 'BDT',
      },
    });
    const refund = await prisma.refund.create({
      data: {
        orderId: order.id,
        paymentId: payment.id,
        amountMinor: 1000,
        currency: 'BDT',
        status: 'SUCCEEDED',
        idempotencyKey: randomUUID(),
      },
    });
    // A row from before `stage` existed: the stage is read from the key.
    await prisma.outboxEvent.create({
      data: {
        eventType: 'REFUND_UPDATE',
        dedupeKey: `refund-update:${refund.id}:succeeded`,
        payload: { refundId: refund.id, orderId: order.id },
        nextAttemptAt: new Date(clock.getTime() - 1000),
      },
    });
    await queue('ORDER_CANCELLED', { orderId: order.id });

    expect(await runDueJobs(deps())).toMatchObject({ claimed: 2, sent: 2 });
    const subjects = transport.sent.map((message) => message.subject);
    expect(subjects).toContain(`Refund for order ${order.orderNumber} completed`);
    expect(subjects).toContain(`Order ${order.orderNumber} was cancelled`);
  });

  it('sends staff alerts to active administrators', async () => {
    const { variants } = await makeProduct({
      categoryId,
      name: 'Alert Shoe',
      variants: [{ size: 'M', priceMinor: 1000, stockQuantity: 2, lowStockThreshold: 3 }],
    });
    const variant = variants[0];
    if (!variant) throw new Error('fixture has no variant');

    await queue('LOW_STOCK_ALERT', {
      variantId: variant.id,
      sku: variant.sku,
      currentStock: 2,
      threshold: 3,
    });
    await queue('PAYMENT_REVIEW_REQUIRED', {
      orderId: 'order-id-1234',
      orderNumber: 'ORD-REVIEW',
      reason: 'AMOUNT_MISMATCH',
    });

    expect(await runDueJobs(deps())).toMatchObject({ sent: 2 });
    for (const message of transport.sent) {
      expect(message.to).toContain(admin.email);
      expect(message.to).not.toContain(customer.email);
    }
  });
});

// ---------------------------------------------------------------------------
// Failure, retry and giving up
// ---------------------------------------------------------------------------

describe('failure', () => {
  it('an email outage does not affect the order, and the receipt goes out once it is over', async () => {
    const { variants } = await makeProduct({
      categoryId,
      name: 'Outage Shoe',
      variants: [{ size: 'M', priceMinor: 250_000, stockQuantity: 5, lowStockThreshold: 0 }],
    });
    const variant = variants[0];
    if (!variant) throw new Error('fixture has no variant');

    transport.failure = new EmailDeliveryError('Email not sent (ECONNECTION): relay down', false);

    const placed = await request(app)
      .post(`${API}/checkout`)
      .set('origin', ORIGIN)
      .set('cookie', customer.cookie)
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
        paymentMethod: 'COD',
        expectedTotalMinor:
          250_000 + deliveryFeeMinor('standard', { city: 'Dhaka', countryCode: 'BD' }),
      });
    expect(placed.status).toBe(201);
    const orderId = (placed.body as { data: { id: string } }).data.id;

    const receipt = await prisma.outboxEvent.findUniqueOrThrow({
      where: { dedupeKey: `order-receipt:${orderId}` },
    });
    // Due straight away; the clock is moved past its scheduled time.
    clock = new Date(receipt.nextAttemptAt.getTime() + 1000);

    expect(await runDueJobs(deps())).toMatchObject({ claimed: 1, retrying: 1 });
    const failed = await job(receipt.id);
    expect(failed).toMatchObject({ status: 'FAILED', attemptCount: 1, claimToken: null });
    expect(failed.lastError).toContain('relay down');
    // First retry: 30 s exponential, half fixed and half jitter (random 0.5) = 22.5 s.
    expect(failed.nextAttemptAt.getTime() - clock.getTime()).toBe(22_500);

    // The order is committed and unaffected, and stock stayed claimed.
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).not.toBe('CANCELLED');
    expect(
      (await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stockQuantity,
    ).toBe(4);

    // Not due yet: nothing happens before the retry time.
    expect((await runDueJobs(deps())).claimed).toBe(0);

    transport.failure = null;
    clock = new Date(failed.nextAttemptAt.getTime() + 1);
    expect(await runDueJobs(deps())).toMatchObject({ claimed: 1, sent: 1 });
    expect(await job(receipt.id)).toMatchObject({ status: 'SENT', attemptCount: 2 });
    expect(transport.sent).toHaveLength(1);
  });

  it('gives up after the last allowed try, with a redacted error', async () => {
    const order = await customerOrder();
    const row = await queue(
      'ORDER_RECEIPT',
      { orderId: order.id },
      { status: 'FAILED', attemptCount: MAX_ATTEMPTS - 1 },
    );
    transport.failure = new EmailDeliveryError(
      `Email not sent (421): mailbox ${order.contactEmail} busy, see https://relay.example/help?x=1`,
      false,
    );

    expect(await runDueJobs(deps())).toMatchObject({ dead: 1 });
    const dead = await job(row.id);
    expect(dead).toMatchObject({ status: 'DEAD', attemptCount: MAX_ATTEMPTS });
    expect(dead.lastError).toContain('[email]');
    expect(dead.lastError).toContain('[url]');
    expect(dead.lastError).not.toContain(order.contactEmail);
  });

  it('gives up at once on a permanent failure', async () => {
    const order = await customerOrder();
    const refused = await queue('ORDER_RECEIPT', { orderId: order.id });
    const missing = await queue('ORDER_RECEIPT', { orderId: 'no-such-order-0000' });
    const malformed = await queue('SHIPPING_UPDATE', { nothing: true });
    transport.failure = new EmailDeliveryError('Email refused (550): no such user', true);

    expect(await runDueJobs(deps())).toMatchObject({ claimed: 3, dead: 3 });
    expect(await job(refused.id)).toMatchObject({ status: 'DEAD', attemptCount: 1 });
    expect((await job(missing.id)).lastError).toBe('The order no longer exists');
    expect((await job(malformed.id)).lastError).toBe('The job payload is not valid for its type');
  });
});

// ---------------------------------------------------------------------------
// Claims, leases and concurrent workers
// ---------------------------------------------------------------------------

describe('claims', () => {
  it('never gives the same row to two workers polling at once', async () => {
    const order = await customerOrder();
    await Promise.all(
      Array.from({ length: 24 }, () => queue('ORDER_RECEIPT', { orderId: order.id })),
    );

    const batches = await Promise.all(
      Array.from({ length: 4 }, () => claimDueJobs({ now: clock, limit: 10 })),
    );
    const ids = batches.flat().map((claimed) => claimed.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(24);
  });

  it('takes over a row whose worker stopped, and fences the stale worker out', async () => {
    const order = await customerOrder();
    const row = await queue('ORDER_RECEIPT', { orderId: order.id });

    const [stale] = await claimDueJobs({ now: clock, limit: 1 });
    if (!stale) throw new Error('nothing claimed');
    expect(await claimDueJobs({ now: minutes(1), limit: 1 })).toHaveLength(0);

    // The lease (5 minutes) ran out; another worker takes it over.
    const [fresh] = await claimDueJobs({ now: minutes(6), limit: 1 });
    expect(fresh?.id).toBe(row.id);
    expect(fresh?.attemptCount).toBe(2);
    expect(fresh?.claimToken).not.toBe(stale.claimToken);

    // The first worker wakes up and tries to record its outcome: it is refused.
    expect(await completeJob(stale, { now: minutes(6), recurringIntervalMs: INTERVAL })).toBe(
      false,
    );
    expect(
      (
        await failJob(stale, new Error('late'), {
          now: minutes(6),
          permanent: false,
          recurringIntervalMs: INTERVAL,
        })
      ).recorded,
    ).toBe(false);
    expect(await job(row.id)).toMatchObject({
      status: 'PROCESSING',
      claimToken: fresh?.claimToken,
    });

    if (!fresh) throw new Error('nothing claimed');
    expect(await completeJob(fresh, { now: minutes(6), recurringIntervalMs: INTERVAL })).toBe(true);
    expect((await job(row.id)).status).toBe('SENT');
  });

  it('sends a row that keeps killing its worker to a person', async () => {
    const order = await customerOrder();
    const row = await queue(
      'ORDER_RECEIPT',
      { orderId: order.id },
      {
        status: 'PROCESSING',
        claimToken: randomUUID(),
        attemptCount: MAX_ATTEMPTS,
        nextAttemptAt: minutes(-1),
      },
    );

    expect(await claimDueJobs({ now: clock, limit: 5 })).toHaveLength(0);
    const dead = await job(row.id);
    expect(dead).toMatchObject({ status: 'DEAD', claimToken: null });
    expect(dead.lastError).toContain('the worker stopped');
  });
});

// ---------------------------------------------------------------------------
// Account emails
// ---------------------------------------------------------------------------

describe('account emails', () => {
  it('sends the reset link, then removes it from the database', async () => {
    await request(app)
      .post(`${AUTH}/request-password-reset`)
      .send({ email: customer.email, redirectTo: 'http://localhost:3000/reset-password' });
    const row = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'PASSWORD_RESET' },
    });
    const url = (row.payload as { url: string }).url;
    clock = new Date(row.nextAttemptAt.getTime() + 1000);

    expect(await runDueJobs(deps())).toMatchObject({ sent: 1 });
    expect(transport.sent[0]?.to).toEqual([customer.email]);
    expect(transport.sent[0]?.text).toContain(url);
    expect((await job(row.id)).payload).toEqual({ userId: customer.userId, scrubbed: true });
  });

  it('does not send a link that has expired, and it cannot be retried', async () => {
    const row = await queue(
      'PASSWORD_RESET',
      {
        userId: customer.userId,
        email: customer.email,
        name: 'Jobs Customer',
        url: 'http://localhost:4000/api/v1/auth/reset-password/secret-token',
      },
      { createdAt: minutes(-61) },
    );

    expect(await runDueJobs(deps())).toMatchObject({ dead: 1 });
    expect(transport.sent).toHaveLength(0);
    const dead = await job(row.id);
    expect(dead.lastError).toBe('The link expired before it could be sent');
    expect(JSON.stringify(dead.payload)).not.toContain('secret-token');

    const retry = await post(`/admin/jobs/${row.id}/retry`);
    expect(retry.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// The recurring sweep
// ---------------------------------------------------------------------------

describe('payment reconciliation schedule', () => {
  it('exists once, runs when due, and is rescheduled rather than finished', async () => {
    await ensureRecurringJobs(clock);
    await ensureRecurringJobs(clock);
    expect(await prisma.outboxEvent.count({ where: { eventType: 'PAYMENT_RECONCILIATION' } })).toBe(
      1,
    );

    let runs = 0;
    const handlers = {
      ...DEFAULT_HANDLERS,
      PAYMENT_RECONCILIATION: () => {
        runs += 1;
        return Promise.resolve(undefined);
      },
    };

    // Three recurring rows are due at first: this sweep, and the assistant's index sweep and
    // retention purge (ADR 0025). The index sweep has no providers in this suite, so it is
    // skipped and rescheduled.
    expect(await runDueJobs(deps(handlers))).toMatchObject({ claimed: 3, sent: 2, skipped: 1 });
    expect(runs).toBe(1);

    const row = await prisma.outboxEvent.findUniqueOrThrow({
      where: { dedupeKey: RECONCILIATION_DEDUPE_KEY },
    });
    expect(row).toMatchObject({ status: 'PENDING', attemptCount: 0 });
    expect(row.nextAttemptAt.getTime()).toBe(clock.getTime() + INTERVAL);

    expect((await runDueJobs(deps(handlers))).claimed).toBe(0);
    clock = new Date(clock.getTime() + INTERVAL);
    await runDueJobs(deps(handlers));
    expect(runs).toBe(2);
  });

  it('keeps retrying a failing sweep and never gives up on it', async () => {
    await ensureRecurringJobs(clock);
    await prisma.outboxEvent.update({
      where: { dedupeKey: RECONCILIATION_DEDUPE_KEY },
      data: { status: 'FAILED', attemptCount: MAX_ATTEMPTS + 3 },
    });
    const handlers = {
      ...DEFAULT_HANDLERS,
      PAYMENT_RECONCILIATION: () => Promise.reject(new Error('provider down')),
    };

    expect(await runDueJobs(deps(handlers))).toMatchObject({ retrying: 1 });
    const row = await prisma.outboxEvent.findUniqueOrThrow({
      where: { dedupeKey: RECONCILIATION_DEDUPE_KEY },
    });
    expect(row.status).toBe('FAILED');
    // Never later than the regular interval.
    expect(row.nextAttemptAt.getTime() - clock.getTime()).toBeLessThanOrEqual(INTERVAL);
  });
});

// ---------------------------------------------------------------------------
// Admin: visibility and manual retry
// ---------------------------------------------------------------------------

describe('admin jobs API', () => {
  async function deadReceipt() {
    const order = await customerOrder();
    return queue(
      'ORDER_RECEIPT',
      { orderId: order.id, orderNumber: order.orderNumber },
      { status: 'DEAD', attemptCount: MAX_ATTEMPTS, lastError: 'Email not sent (ECONNECTION)' },
    );
  }

  it('is refused to customers and to signed-out callers', async () => {
    expect((await get('/admin/jobs', customer)).status).toBe(403);
    expect((await request(app).get(`${API}/admin/jobs/summary`)).status).toBe(401);
    const row = await deadReceipt();
    expect((await post(`/admin/jobs/${row.id}/retry`, {}, customer)).status).toBe(403);
    expect((await job(row.id)).status).toBe('DEAD');
  });

  it('lists jobs by status without exposing payloads', async () => {
    const dead = await deadReceipt();
    await queue('PASSWORD_RESET', {
      userId: customer.userId,
      email: customer.email,
      name: 'Jobs Customer',
      url: 'http://localhost:4000/api/v1/auth/reset-password/another-secret',
    });

    const all = await get('/admin/jobs');
    expect(all.status).toBe(200);
    const body = JSON.stringify(all.body);
    expect(body).not.toContain('another-secret');
    expect(body).not.toContain(customer.email);
    expect(body).not.toContain('payload');

    const onlyDead = await get('/admin/jobs?status=DEAD');
    const items = (onlyDead.body as { data: { id: string; subject: object; retryable: boolean }[] })
      .data;
    expect(items.map((item) => item.id)).toEqual([dead.id]);
    expect(items[0]?.retryable).toBe(true);
    expect(items[0]?.subject).toMatchObject({ orderNumber: expect.any(String) as string });

    expect((await get('/admin/jobs?status=LOST')).status).toBe(400);
  });

  it('summarises the queue', async () => {
    await deadReceipt();
    await queue('LOW_STOCK_ALERT', { variantId: 'v', sku: 'S', currentStock: 1, threshold: 2 });
    await ensureRecurringJobs(clock);

    const res = await get('/admin/jobs/summary');
    expect(res.status).toBe(200);
    const summary = (
      res.body as {
        data: { counts: Record<OutboxStatus, number>; due: number; reconciliation: object | null };
      }
    ).data;
    expect(summary.counts).toMatchObject({ DEAD: 1, PENDING: 1 });
    expect(summary).toMatchObject({ retryableDead: 1 });
    expect(summary.due).toBe(1);
    expect(summary.reconciliation).toMatchObject({ status: 'PENDING' });
  });

  it('retries a dead job once, and audits it', async () => {
    const row = await deadReceipt();

    const res = await post(`/admin/jobs/${row.id}/retry`);
    expect(res.status).toBe(200);
    expect((res.body as { data: object }).data).toMatchObject({
      status: 'PENDING',
      attemptCount: 0,
    });

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'outbox.job.retried', entityId: row.id },
    });
    expect(audit.actorUserId).toBe(admin.userId);

    // Already waiting: a second retry is refused, and two at once retry it once.
    expect((await post(`/admin/jobs/${row.id}/retry`)).status).toBe(409);

    const other = await deadReceipt();
    const both = await Promise.all([
      post(`/admin/jobs/${other.id}/retry`),
      post(`/admin/jobs/${other.id}/retry`),
    ]);
    expect(both.map((response) => response.status).sort()).toEqual([200, 409]);

    // The retried job really goes out. The retry used the real clock, so catch up with it.
    clock = minutes(1);
    expect(await runDueJobs(deps())).toMatchObject({ sent: 2 });
  });

  it('refuses to retry a sent job and reports an unknown one', async () => {
    const order = await customerOrder();
    const sent = await queue(
      'ORDER_RECEIPT',
      { orderId: order.id },
      { status: 'SENT', processedAt: clock },
    );

    expect((await post(`/admin/jobs/${sent.id}/retry`)).status).toBe(409);
    expect((await post('/admin/jobs/no-such-job-000/retry')).status).toBe(404);
  });

  it('retries every dead job that can still be sent', async () => {
    await deadReceipt();
    await deadReceipt();
    const unsendable = await queue(
      'PASSWORD_RESET',
      { userId: customer.userId, scrubbed: true },
      { status: 'DEAD' },
    );

    expect((await post('/admin/jobs/retry', { status: 'FAILED' })).status).toBe(400);

    const res = await post('/admin/jobs/retry', { status: 'DEAD' });
    expect(res.status).toBe(200);
    expect((res.body as { data: object }).data).toEqual({ retried: 2, remaining: 0 });
    expect((await job(unsendable.id)).status).toBe('DEAD');
    expect(
      await prisma.auditLog.count({ where: { action: 'outbox.jobs.bulk_retried' } }),
    ).toBeGreaterThanOrEqual(1);
  });
});
