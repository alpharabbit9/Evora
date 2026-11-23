import { createHash } from 'node:crypto';

import type { PaymentMethod, PaymentStatus, Prisma } from '@prisma/client';

import { env } from '../../config/env.js';
import {
  conflict,
  notFound,
  paymentPending,
  providerUnavailable,
  unauthenticated,
} from '../../http/errors.js';
import type { Actor } from '../../http/guards.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { type TransactionClient, withTransaction } from '../../lib/transaction.js';
import { reclaimCoupon, releaseCoupon } from '../coupons/coupons.service.js';
import { releaseStock, tryReclaimStock } from '../inventory/inventory.service.js';
import {
  type Decision,
  PAYMENT_WINDOW_MS,
  type ReviewReason,
  canResumePayment,
  decide,
} from './payment-state.js';
import {
  type FailureCode,
  type PaymentProvider,
  type PaymentSession,
  type ProviderStatus,
  ProviderUnavailableError,
  type VerifiedNotification,
} from './provider.js';
import { onlineProvider, providerByName } from './provider-registry.js';

/**
 * Online payments (architecture.md §7 steps 5-6, §9, ADR 0003, ADR 0019).
 *
 * The shape: a provider message is a doorbell, not a statement of fact. Whatever rings it (webhook,
 * browser return, reconciliation sweep), the response is the same: ask the provider directly what
 * happened, outside any transaction, then apply that answer in one short transaction through the
 * state machine in `payment-state.ts`. So a duplicate, a late arrival or a forged redirect has
 * nothing to grip: each can only cause us to ask again, and asking again is harmless.
 */

const API_PREFIX = '/api/v1';

/** Long enough for the customer's own return and the notification to settle a fresh payment first. */
const RECONCILE_GRACE_MS = 5 * 60 * 1000;
/** How far back a closed payment is rechecked for money that arrived after it closed. */
const LATE_PAYMENT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function callbackBase(): string {
  return (env.PAYMENT_CALLBACK_BASE_URL ?? env.BETTER_AUTH_URL).replace(/\/+$/, '');
}

function readGatewayUrl(metadata: Prisma.JsonValue): string | null {
  if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const url = metadata.gatewayUrl;

    return typeof url === 'string' ? url : null;
  }

  return null;
}

/**
 * Where to send the customer to pay. Deliberately not part of placing the order: checkout commits
 * with no network call, and this runs afterwards. So first attempt, retry after a provider outage
 * and coming back later are all the same code, and an outage here leaves a recoverable order.
 *
 * A session the provider already issued is reused, so repeating this does not open a second one.
 */
export async function startPaymentSession(
  actor: Actor,
  orderId: string,
): Promise<{ redirectUrl: string }> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: actor.id },
    select: {
      status: true,
      paymentMethod: true,
      orderNumber: true,
      contactEmail: true,
      contactPhone: true,
      shipRecipientName: true,
      shipLine1: true,
      shipCity: true,
      shipPostalCode: true,
      shipCountryCode: true,
      items: { select: { productNameSnapshot: true, quantity: true } },
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          id: true,
          provider: true,
          status: true,
          amountMinor: true,
          currency: true,
          safeMetadata: true,
          createdAt: true,
        },
      },
    },
  });

  if (!order) {
    throw notFound('That order does not exist.');
  }

  const payment = order.payments[0];

  if (order.paymentMethod !== 'ONLINE' || !payment) {
    throw conflict('This order is not paid online.');
  }

  if (payment.status === 'PROCESSING') {
    throw paymentPending(
      'We have your payment and are checking it. There is no need to pay again.',
    );
  }

  const facts = {
    paymentStatus: payment.status,
    orderStatus: order.status,
    createdAt: payment.createdAt,
  };

  if (!canResumePayment(facts)) {
    throw conflict('This order is no longer waiting for payment.');
  }

  const existing = readGatewayUrl(payment.safeMetadata);

  if (existing) {
    return { redirectUrl: existing };
  }

  const provider = providerByName(payment.provider);

  if (!provider) {
    throw providerUnavailable();
  }

  let session: PaymentSession;

  try {
    session = await provider.createSession({
      reference: payment.id,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      productName: order.items.map((item) => item.productNameSnapshot).join(', '),
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
      customer: {
        name: order.shipRecipientName,
        email: order.contactEmail,
        phone: order.contactPhone ?? '',
        line1: order.shipLine1,
        city: order.shipCity,
        postalCode: order.shipPostalCode,
        countryCode: order.shipCountryCode,
      },
      returnUrl: `${callbackBase()}${API_PREFIX}/payments/return/${payment.id}`,
      notifyUrl: `${callbackBase()}${API_PREFIX}/webhooks/payments/${provider.name}`,
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      logger.warn({ paymentId: payment.id, reason: error.message }, 'Could not start payment');
      throw providerUnavailable();
    }

    throw error;
  }

  // Conditional: the payment may have settled while the provider was being called.
  const { count } = await prisma.payment.updateMany({
    where: { id: payment.id, status: 'PENDING' },
    data: { safeMetadata: { sessionRef: session.sessionRef, gatewayUrl: session.redirectUrl } },
  });

  if (count === 0) {
    throw conflict('This order is no longer waiting for payment.');
  }

  return { redirectUrl: session.redirectUrl };
}

type LockedPayment = Prisma.PaymentGetPayload<{ select: typeof LOCKED_SELECT }>;

const LOCKED_SELECT = {
  id: true,
  status: true,
  provider: true,
  providerPaymentRef: true,
  amountMinor: true,
  currency: true,
  order: {
    select: {
      id: true,
      status: true,
      userId: true,
      orderNumber: true,
      items: { select: { variantId: true, quantity: true } },
    },
  },
} satisfies Prisma.PaymentSelect;

function stockLines(payment: LockedPayment) {
  return payment.order.items.flatMap((item) =>
    item.variantId ? [{ variantId: item.variantId, quantity: item.quantity }] : [],
  );
}

/** Idempotent: one row per payment and reason, however often the same news arrives. */
async function requestReview(tx: TransactionClient, payment: LockedPayment, reason: ReviewReason) {
  await tx.outboxEvent.createMany({
    data: [
      {
        eventType: 'PAYMENT_REVIEW_REQUIRED',
        dedupeKey: `payment-review:${payment.id}:${reason}`,
        payload: {
          paymentId: payment.id,
          orderId: payment.order.id,
          orderNumber: payment.order.orderNumber,
          reason,
        },
      },
    ],
    skipDuplicates: true,
  });
  logger.warn({ paymentId: payment.id, reason }, 'Payment needs review');
}

async function confirmOrder(
  tx: TransactionClient,
  payment: LockedPayment,
  providerRef: string,
  late: boolean,
): Promise<void> {
  const { order } = payment;

  await tx.payment.update({
    where: { id: payment.id },
    data: {
      status: 'SUCCEEDED',
      providerPaymentRef: providerRef,
      capturedAt: new Date(),
      failureCode: null,
    },
  });

  if (late) {
    const lines = stockLines(payment);
    const reclaimed =
      lines.length === order.items.length && (await tryReclaimStock(tx, lines, order.id));

    if (reclaimed) await reclaimCoupon(tx, order.id);

    if (!reclaimed) {
      // Someone else bought the goods. The money is real, so it is recorded, and a person refunds it.
      await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
      await requestReview(tx, payment, 'PAID_AFTER_CLOSE');
      return;
    }
  }

  await tx.order.update({
    where: { id: order.id },
    data: { status: 'CONFIRMED', paymentStatus: 'PAID' },
  });
  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: 'CONFIRMED',
      isSystem: true,
      reason: late ? 'Payment verified after the order had closed' : 'Payment verified',
    },
  });

  // The receipt waits for the money, and the bag empties only now: a customer whose payment fails
  // goes back to the bag they had.
  await tx.outboxEvent.createMany({
    data: [
      {
        eventType: 'ORDER_RECEIPT',
        dedupeKey: `order-receipt:${order.id}`,
        payload: { orderId: order.id, orderNumber: order.orderNumber },
      },
    ],
    skipDuplicates: true,
  });

  if (order.userId) {
    await tx.cartItem.deleteMany({
      where: {
        variantId: { in: stockLines(payment).map((line) => line.variantId) },
        cart: { userId: order.userId, status: 'ACTIVE' },
      },
    });
  }
}

async function failOrder(
  tx: TransactionClient,
  payment: LockedPayment,
  code: FailureCode,
): Promise<void> {
  const { order } = payment;

  await tx.payment.update({
    where: { id: payment.id },
    data: { status: code === 'CANCELLED' ? 'CANCELLED' : 'FAILED', failureCode: code },
  });
  await tx.order.update({
    where: { id: order.id },
    data: { status: 'PAYMENT_FAILED', paymentStatus: 'FAILED' },
  });
  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: 'PAYMENT_FAILED',
      isSystem: true,
      reason: `Payment did not complete (${code})`,
    },
  });
  // Compensation for decrement-on-order (ADR 0004): the goods go back on sale.
  await releaseStock(tx, stockLines(payment), order.id, 'ORDER_CANCELLED');
  // After the stock (lock order, `modules/coupons`): a failed payment does not use up a code.
  await releaseCoupon(tx, order.id);
}

async function perform(
  tx: TransactionClient,
  payment: LockedPayment,
  decision: Decision,
  news: ProviderStatus,
): Promise<void> {
  const providerRef = news.kind === 'succeeded' ? news.providerRef : null;

  switch (decision.type) {
    case 'none':
      return;
    case 'review':
      await requestReview(tx, payment, decision.reason);
      return;
    case 'hold':
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'PROCESSING',
          failureCode: decision.reason,
          ...(providerRef ? { providerPaymentRef: providerRef } : {}),
        },
      });
      await requestReview(tx, payment, decision.reason);
      return;
    case 'confirm':
      if (providerRef) await confirmOrder(tx, payment, providerRef, decision.late);
      return;
    case 'captureOnly':
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'SUCCEEDED',
          capturedAt: new Date(),
          failureCode: null,
          ...(providerRef ? { providerPaymentRef: providerRef } : {}),
        },
      });
      await tx.order.update({ where: { id: payment.order.id }, data: { paymentStatus: 'PAID' } });
      await requestReview(tx, payment, 'PAID_AFTER_CLOSE');
      return;
    case 'fail':
      await failOrder(tx, payment, decision.code);
      return;
  }
}

/**
 * The single place payment news changes anything. The order row is locked first, so everything
 * that could touch this order takes turns; each then reads the state its predecessor committed and
 * finds there is nothing left to do. `finish` commits in the same transaction, so an event can
 * never be marked processed unless its effect was committed too.
 */
async function applyNews(
  paymentId: string,
  news: ProviderStatus,
  finish?: (tx: TransactionClient) => Promise<void>,
): Promise<Decision['type']> {
  return withTransaction(
    async (tx) => {
      const head = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { orderId: true },
      });

      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${head.orderId} FOR UPDATE`;

      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: LOCKED_SELECT,
      });

      const decision = decide(
        {
          paymentStatus: payment.status,
          orderStatus: payment.order.status,
          providerRef: payment.providerPaymentRef,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
        },
        news,
      );

      await perform(tx, payment, decision, news);
      await finish?.(tx);

      return decision.type;
    },
    { label: 'payments.applyNews' },
  );
}

/** Ask the provider, then apply the answer. Used wherever there is no notification to go on. */
export async function syncPayment(provider: PaymentProvider, paymentId: string): Promise<void> {
  await applyNews(paymentId, await provider.fetchStatus(paymentId));
}

function payloadHash(fields: Readonly<Record<string, string>>): string {
  const canonical = Object.keys(fields)
    .sort()
    .map((key) => [key, fields[key]]);

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

/** Short and ours: a stored error must not quote a URL, a payload or a provider message. */
function safeErrorLabel(error: unknown): string {
  if (error instanceof ProviderUnavailableError) {
    return error.message;
  }

  return error instanceof Error ? error.name : 'UnknownError';
}

/**
 * Insert first: `(provider, event_id)` being unique IS the deduplication (ADR 0003). An event that
 * already finished is a duplicate. One that was received but never finished (a crash, an outage)
 * is allowed through again, which is what makes a provider's retry useful.
 */
async function recordEvent(
  providerName: string,
  notification: VerifiedNotification,
  hash: string,
): Promise<{ id: string; alreadyDone: boolean }> {
  try {
    const created = await prisma.webhookEvent.create({
      data: {
        provider: providerName,
        eventId: notification.eventId,
        eventType: notification.eventType,
        payloadHash: hash,
        safeMetadata: notification.safeMetadata,
        attemptCount: 1,
      },
      select: { id: true },
    });

    return { id: created.id, alreadyDone: false };
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
  }

  const existing = await prisma.webhookEvent.update({
    where: { provider_eventId: { provider: providerName, eventId: notification.eventId } },
    data: { attemptCount: { increment: 1 } },
    select: { id: true, status: true },
  });

  return { id: existing.id, alreadyDone: existing.status === 'PROCESSED' };
}

async function markEventFailed(eventId: string, reason: string): Promise<void> {
  await prisma.webhookEvent
    .update({ where: { id: eventId }, data: { status: 'FAILED', lastError: reason } })
    .catch((error: unknown) => {
      logger.error({ err: error, eventId }, 'Could not record a webhook failure');
    });
}

/**
 * What to apply, given the provider's answer and a signed claim:
 *   - the direct answer wins when it is decisive, so order of arrival cannot matter;
 *   - a signed failure stands when the provider has nothing decisive, because a cancelled attempt
 *     may never appear in its status query. A later success can still overturn it.
 *   - a signed success with no direct confirmation yet is not good enough: `null`, and try later.
 */
function resolveNews(
  truth: ProviderStatus,
  notification: VerifiedNotification,
): ProviderStatus | null {
  if (truth.kind !== 'pending') {
    return truth;
  }

  if (notification.claim.kind === 'failed') {
    return { kind: 'failed', code: notification.claim.code };
  }

  return notification.claim.kind === 'succeeded' ? null : truth;
}

async function processNotification(
  provider: PaymentProvider,
  notification: VerifiedNotification,
  fields: Readonly<Record<string, string>>,
): Promise<{ duplicate: boolean }> {
  const event = await recordEvent(provider.name, notification, payloadHash(fields));

  if (event.alreadyDone) {
    return { duplicate: true };
  }

  const payment = await prisma.payment.findFirst({
    where: { id: notification.reference, provider: provider.name },
    select: { id: true },
  });

  if (!payment) {
    // Correctly signed, but about nothing of ours. A retry could not help, so it is acknowledged.
    logger.warn({ eventId: event.id }, 'Payment notification names an unknown payment');
    await markEventFailed(event.id, 'UNKNOWN_PAYMENT');
    return { duplicate: false };
  }

  try {
    const news = resolveNews(await provider.fetchStatus(notification.reference), notification);

    if (!news) {
      throw new ProviderUnavailableError('SSLCOMMERZ has not confirmed this payment yet');
    }

    await applyNews(payment.id, news, async (tx) => {
      await tx.webhookEvent.update({
        where: { id: event.id },
        data: { status: 'PROCESSED', processedAt: new Date(), lastError: null },
      });
    });

    return { duplicate: false };
  } catch (error) {
    await markEventFailed(event.id, safeErrorLabel(error));

    if (error instanceof ProviderUnavailableError) {
      // A non-2xx asks the provider to retry. Reconciliation is the backstop if it never does.
      throw providerUnavailable('The payment could not be confirmed yet.');
    }

    throw error;
  }
}

/** `POST /webhooks/payments/:provider`. The signature is checked before anything is stored. */
export async function handleProviderNotification(
  providerName: string,
  fields: Readonly<Record<string, string>>,
): Promise<{ duplicate: boolean }> {
  const provider = providerByName(providerName);

  if (!provider) {
    throw notFound();
  }

  const notification = provider.verifyNotification(fields);

  if (!notification) {
    logger.warn({ provider: providerName }, 'Payment notification failed signature verification');
    throw unauthenticated('The notification signature is not valid.');
  }

  return processNotification(provider, notification, fields);
}

/**
 * The customer's browser came back from the gateway. Anyone can call this, and it never says what
 * it found: it only makes us check, so forging it achieves nothing, and the page it leads to reads
 * persisted state. A failure here must not strand the customer on an error page, because the
 * payment is still recoverable; it is logged and they go to the order, which shows "still confirming".
 *
 * @returns the storefront path to send the browser to.
 */
export async function handleBrowserReturn(
  paymentId: string,
  fields: Readonly<Record<string, string>>,
): Promise<string> {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { id: true, orderId: true, provider: true, status: true },
  });

  if (!payment) {
    return '/account';
  }

  const destination = `/orders/${payment.orderId}?payment=returned`;
  const provider = providerByName(payment.provider);

  if (!provider || payment.status === 'SUCCEEDED') {
    return destination;
  }

  try {
    const signed = provider.verifyNotification(fields);

    if (signed?.reference === payment.id) {
      await processNotification(provider, signed, fields);
    } else {
      await syncPayment(provider, payment.id);
    }
  } catch (error) {
    logger.warn(
      { paymentId: payment.id, reason: safeErrorLabel(error) },
      'Could not settle a payment on browser return',
    );
  }

  return destination;
}

export interface ReconcileSummary {
  readonly checked: number;
  readonly unavailable: number;
  readonly expired: number;
  readonly settled: number;
}

/**
 * The backstop (ADR 0003): settles what no notification did, and releases the stock of abandoned
 * orders. Covers a closed browser, a lost notification and a provider outage. Every step goes
 * through `applyNews`, so it is safe to run at any time, repeatedly, or concurrently.
 *
 * An unknown status is never treated as a failure: the payment is left for the next run, because
 * expiring it could release goods somebody has paid for.
 *
 * `PROCESSING` is not swept. That is a payment held for a person to review.
 */
export async function reconcilePayments(
  options: { now?: Date; limit?: number } = {},
): Promise<ReconcileSummary> {
  const provider = onlineProvider();
  const now = options.now ?? new Date();
  const limit = options.limit ?? 100;
  const summary = { checked: 0, unavailable: 0, expired: 0, settled: 0 };

  if (!provider) {
    return summary;
  }

  const open = await prisma.payment.findMany({
    where: {
      provider: provider.name,
      status: 'PENDING',
      createdAt: { lte: new Date(now.getTime() - RECONCILE_GRACE_MS) },
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true, createdAt: true },
  });

  for (const payment of open) {
    summary.checked += 1;

    try {
      const truth = await provider.fetchStatus(payment.id);
      const overdue = now.getTime() - payment.createdAt.getTime() >= PAYMENT_WINDOW_MS;
      const news: ProviderStatus =
        truth.kind === 'pending' && overdue ? { kind: 'failed', code: 'EXPIRED' } : truth;
      const outcome = await applyNews(payment.id, news);

      if (outcome === 'fail' && truth.kind === 'pending') summary.expired += 1;
      else if (outcome !== 'none') summary.settled += 1;
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      summary.unavailable += 1;
    }
  }

  // Money can arrive after a payment closed. Only a success changes anything for these.
  const closed = await prisma.payment.findMany({
    where: {
      provider: provider.name,
      status: { in: ['FAILED', 'CANCELLED'] },
      updatedAt: { gte: new Date(now.getTime() - LATE_PAYMENT_LOOKBACK_MS) },
    },
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: { id: true },
  });

  for (const payment of closed) {
    summary.checked += 1;

    try {
      const truth = await provider.fetchStatus(payment.id);

      if (truth.kind === 'succeeded' && (await applyNews(payment.id, truth)) !== 'none') {
        summary.settled += 1;
      }
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      summary.unavailable += 1;
    }
  }

  return summary;
}

/**
 * A person has checked a payment held for risk and is satisfied (ADR 0020). It completes exactly
 * as a verified payment would have. Only `RISK_REVIEW`: a payment held for the wrong amount was
 * not paid in full, and accepting it would hand over goods for less than their price.
 *
 * @returns `false` when there is nothing to accept (already resolved, or not that kind of hold).
 */
export async function acceptHeldPayment(
  tx: TransactionClient,
  paymentId: string,
): Promise<boolean> {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { ...LOCKED_SELECT, failureCode: true },
  });

  if (
    payment.status !== 'PROCESSING' ||
    payment.failureCode !== 'RISK_REVIEW' ||
    payment.order.status !== 'PENDING_PAYMENT' ||
    !payment.providerPaymentRef
  ) {
    return false;
  }

  await confirmOrder(tx, payment, payment.providerPaymentRef, false);

  return true;
}

export interface PaymentView {
  readonly id: string;
  readonly orderId: string;
  readonly provider: string;
  readonly method: PaymentMethod;
  readonly status: PaymentStatus;
  readonly amountMinor: number;
  readonly currency: string;
  readonly createdAt: Date;
  /** Administrators only: it can name a fraud hold, which a customer should not see. */
  readonly failureCode?: string | null;
}

/** `GET /payments/:paymentId`. A safe projection: no provider reference, session or metadata. */
export async function getPaymentForViewer(actor: Actor, paymentId: string): Promise<PaymentView> {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, ...(actor.isAdmin ? {} : { order: { userId: actor.id } }) },
    select: {
      id: true,
      orderId: true,
      provider: true,
      method: true,
      status: true,
      amountMinor: true,
      currency: true,
      createdAt: true,
      failureCode: true,
    },
  });

  if (!payment) {
    throw notFound('That payment does not exist.');
  }

  const { failureCode, ...view } = payment;

  return actor.isAdmin ? { ...view, failureCode } : view;
}
