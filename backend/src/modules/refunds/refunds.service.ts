import { createHash } from 'node:crypto';

import type { Prisma, RefundStatus } from '@prisma/client';

import { conflict, idempotencyConflict, notFound } from '../../http/errors.js';
import type { Actor } from '../../http/guards.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { type TransactionClient, withTransaction } from '../../lib/transaction.js';
import type { AdminActionContext } from '../admin/customers.service.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';
import { ProviderUnavailableError, type RefundStart } from '../payments/provider.js';
import { onlineProvider, providerByName } from '../payments/provider-registry.js';

/**
 * Refunds (PRD FR-06, ADR 0020). The rule that shapes everything here: one logical refund is one
 * `refunds` row, and the provider is only ever asked about that row by its own id.
 *
 *   1. In a short transaction, with the order row locked, check what is still refundable and write
 *      the row (`PENDING`). Two concurrent requests take turns on the lock, so together they can
 *      never exceed what was paid.
 *   2. After commit, ask the provider, sending the row's id as `refund_trans_id`.
 *   3. Record its answer conditionally, so a late or repeated answer cannot apply twice.
 *
 * If step 2's answer is lost, the row stays `PENDING` with no provider reference, and the only way
 * forward is to ask again with the SAME id (`reconcileRefunds`). A new request is a new row, and
 * the refundable check in step 1 already counts the pending one, so a retried click cannot become a
 * second refund either.
 *
 * Cash on delivery has no provider: a refund of collected cash is recorded as already handed back
 * (`SUCCEEDED` at once), because the money moves outside the system.
 */

const RECONCILE_GRACE_MS = 2 * 60 * 1000;

export interface RefundView {
  readonly id: string;
  readonly orderId: string;
  readonly paymentId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: RefundStatus;
  readonly reason: string | null;
  /** Online refunds only: the provider has acknowledged it. */
  readonly providerAcknowledged: boolean;
  readonly createdAt: Date;
}

const REFUND_VIEW_SELECT = {
  id: true,
  orderId: true,
  paymentId: true,
  amountMinor: true,
  currency: true,
  status: true,
  reason: true,
  providerRefundRef: true,
  createdAt: true,
} satisfies Prisma.RefundSelect;

type RefundRow = Prisma.RefundGetPayload<{ select: typeof REFUND_VIEW_SELECT }>;

export function toRefundView(row: RefundRow): RefundView {
  const { providerRefundRef, ...rest } = row;

  return { ...rest, providerAcknowledged: providerRefundRef !== null };
}

/** The order row lock that every change to an order's money takes first (ADR 0019 §6). */
export async function lockOrder(tx: TransactionClient, orderId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
}

/** Idempotent: one row per subject and reason, however often it is raised. */
export async function requestReview(
  tx: TransactionClient,
  subject: { readonly orderId: string; readonly orderNumber: string; readonly id: string },
  reason: string,
): Promise<void> {
  await tx.outboxEvent.createMany({
    data: [
      {
        eventType: 'PAYMENT_REVIEW_REQUIRED',
        dedupeKey: `payment-review:${subject.id}:${reason}`,
        payload: {
          subjectId: subject.id,
          orderId: subject.orderId,
          orderNumber: subject.orderNumber,
          reason,
        },
      },
    ],
    skipDuplicates: true,
  });
  logger.warn({ subjectId: subject.id, reason }, 'Payment needs review');
}

/**
 * Brings a payment and its order up to date with the refunds that have completed. Pure arithmetic
 * over the rows, so running it twice is the same as running it once.
 */
async function settlePaymentAfterRefunds(tx: TransactionClient, paymentId: string): Promise<void> {
  const payment = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    select: { id: true, orderId: true, amountMinor: true },
  });
  const refunded = await tx.refund.aggregate({
    where: { paymentId, status: 'SUCCEEDED' },
    _sum: { amountMinor: true },
  });
  const total = refunded._sum.amountMinor ?? 0;

  if (total <= 0) return;

  const status = total >= payment.amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

  await tx.payment.update({ where: { id: paymentId }, data: { status } });
  await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: status } });
}

export interface NewRefund {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly amountMinor?: number;
  readonly reason: string;
  /** Already scoped: unique across all refunds. */
  readonly idempotencyKey: string;
  readonly requestedBy?: Actor;
}

/**
 * Step 1, inside the caller's transaction, with the order row already locked. Refunds the
 * order's paid payment; with no `amountMinor`, whatever of it is still refundable.
 *
 * @returns the new row, and whether the provider must now be asked (online only).
 */
export async function createRefundRow(
  tx: TransactionClient,
  input: NewRefund,
): Promise<{ refund: RefundRow; mustSend: boolean } | null> {
  const payment = await tx.payment.findFirst({
    where: { orderId: input.orderId, status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, method: true, amountMinor: true, currency: true },
  });

  if (!payment) {
    return null;
  }

  const committed = await tx.refund.aggregate({
    where: { paymentId: payment.id, status: { in: ['PENDING', 'SUCCEEDED'] } },
    _sum: { amountMinor: true },
  });
  const refundable = payment.amountMinor - (committed._sum.amountMinor ?? 0);
  const amountMinor = input.amountMinor ?? refundable;

  if (amountMinor <= 0 && input.amountMinor === undefined) {
    return null;
  }

  if (amountMinor <= 0 || amountMinor > refundable) {
    throw conflict('That is more than is left to refund on this order.', {
      details: [
        {
          field: 'amountMinor',
          issue: `At most ${String(Math.max(refundable, 0))} can still be refunded`,
        },
      ],
    });
  }

  const isCash = payment.method === 'COD';

  const refund = await tx.refund.create({
    data: {
      paymentId: payment.id,
      orderId: input.orderId,
      amountMinor,
      currency: payment.currency,
      // Cash goes back by hand, outside the system: it is recorded as done.
      status: isCash ? 'SUCCEEDED' : 'PENDING',
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      ...(input.requestedBy ? { requestedByUserId: input.requestedBy.id } : {}),
    },
    select: REFUND_VIEW_SELECT,
  });

  await tx.outboxEvent.create({
    data: {
      eventType: 'REFUND_UPDATE',
      dedupeKey: `refund-update:${refund.id}:${isCash ? 'succeeded' : 'requested'}`,
      payload: {
        refundId: refund.id,
        orderId: input.orderId,
        orderNumber: input.orderNumber,
        stage: isCash ? 'succeeded' : 'requested',
      },
    },
  });

  if (isCash) {
    await settlePaymentAfterRefunds(tx, payment.id);
  }

  return { refund, mustSend: !isCash };
}

/**
 * Step 3: records a final answer once. The conditional update is the guard, so a second answer
 * for the same refund (a repeated sweep, a slow response) finds nothing to change.
 */
async function finishRefund(refundId: string, outcome: 'SUCCEEDED' | 'FAILED'): Promise<boolean> {
  return withTransaction(
    async (tx) => {
      const head = await tx.refund.findUniqueOrThrow({
        where: { id: refundId },
        select: { orderId: true, paymentId: true, order: { select: { orderNumber: true } } },
      });

      await lockOrder(tx, head.orderId);

      const { count } = await tx.refund.updateMany({
        where: { id: refundId, status: 'PENDING' },
        data: { status: outcome },
      });

      if (count === 0) return false;

      if (outcome === 'SUCCEEDED') {
        await settlePaymentAfterRefunds(tx, head.paymentId);
        await tx.outboxEvent.createMany({
          data: [
            {
              eventType: 'REFUND_UPDATE',
              dedupeKey: `refund-update:${refundId}:succeeded`,
              payload: {
                refundId,
                orderId: head.orderId,
                orderNumber: head.order.orderNumber,
                stage: 'succeeded',
              },
            },
          ],
          skipDuplicates: true,
        });
      } else {
        // A refund the provider will not make still owes the customer money: a person must act.
        await requestReview(
          tx,
          { id: refundId, orderId: head.orderId, orderNumber: head.order.orderNumber },
          'REFUND_FAILED',
        );
      }

      return true;
    },
    { label: 'refunds.finish' },
  );
}

export type SendOutcome = 'started' | 'unknown' | 'unconfirmed' | 'refused' | 'skipped';

/**
 * Step 2, after commit. Safe to call any number of times: it only acts on a `PENDING` row the
 * provider has not acknowledged, and it always sends that row's own id.
 */
export async function sendRefund(refundId: string): Promise<SendOutcome> {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    select: {
      id: true,
      status: true,
      orderId: true,
      amountMinor: true,
      reason: true,
      providerRefundRef: true,
      order: { select: { orderNumber: true } },
      payment: { select: { provider: true, method: true, providerPaymentRef: true } },
    },
  });

  if (
    !refund ||
    refund.status !== 'PENDING' ||
    refund.providerRefundRef ||
    refund.payment.method !== 'ONLINE'
  ) {
    return 'skipped';
  }

  // The provider already said an earlier attempt got through. Asking again could only risk a
  // second refund, so this one waits for a person (see `alreadyStarted` below).
  if (
    await prisma.outboxEvent.count({
      where: { dedupeKey: `payment-review:${refundId}:REFUND_UNCONFIRMED` },
    })
  ) {
    return 'skipped';
  }

  const provider = providerByName(refund.payment.provider);

  if (!provider || !refund.payment.providerPaymentRef) {
    logger.error({ refundId }, 'A refund has no provider that can make it');
    return 'unknown';
  }

  let start: RefundStart;

  try {
    start = await provider.startRefund({
      refundId: refund.id,
      providerPaymentRef: refund.payment.providerPaymentRef,
      amountMinor: refund.amountMinor,
      reason: refund.reason ?? 'Refund',
    });
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      // It may or may not have arrived. The row says "not acknowledged", which is the truth.
      logger.warn({ refundId, reason: error.message }, 'Refund outcome unknown; will ask again');
      return 'unknown';
    }

    throw error;
  }

  switch (start.kind) {
    case 'started': {
      await prisma.refund.updateMany({
        where: { id: refundId, status: 'PENDING', providerRefundRef: null },
        data: { providerRefundRef: start.providerRefundRef },
      });
      return 'started';
    }
    case 'alreadyStarted': {
      // An earlier attempt got through, but its reference was lost with its response. The money is
      // probably moving; a person confirms it in the provider's panel. Never send a second refund.
      await withTransaction(
        (tx) =>
          requestReview(
            tx,
            { id: refundId, orderId: refund.orderId, orderNumber: refund.order.orderNumber },
            'REFUND_UNCONFIRMED',
          ),
        { label: 'refunds.unconfirmed' },
      );
      return 'unconfirmed';
    }
    case 'refused': {
      await finishRefund(refundId, 'FAILED');
      return 'refused';
    }
  }
}

/** Asks the provider whether an acknowledged refund has completed, and records it if so. */
export async function syncRefund(
  refundId: string,
): Promise<'refunded' | 'processing' | 'cancelled' | 'skipped'> {
  const refund = await prisma.refund.findUnique({
    where: { id: refundId },
    select: { status: true, providerRefundRef: true, payment: { select: { provider: true } } },
  });

  if (!refund || refund.status !== 'PENDING' || !refund.providerRefundRef) {
    return 'skipped';
  }

  const provider = providerByName(refund.payment.provider);

  if (!provider) return 'skipped';

  const state = await provider.fetchRefundStatus(refund.providerRefundRef);

  if (state === 'processing') return state;

  // Two sweeps can both get here for one refund. Only the one whose conditional update applied
  // reports the change; the other found it already recorded.
  const applied = await finishRefund(refundId, state === 'refunded' ? 'SUCCEEDED' : 'FAILED');

  return applied ? state : 'skipped';
}

export interface RefundReconcileSummary {
  readonly checked: number;
  readonly sent: number;
  readonly completed: number;
  readonly failed: number;
  readonly unavailable: number;
}

/**
 * The refund half of the sweep. Unacknowledged refunds are sent again with their own id, and
 * acknowledged ones are checked for completion. A refund the provider has called "already
 * started" stays pending and is not sent again: that is a person's to confirm.
 */
export async function reconcileRefunds(
  options: { now?: Date; limit?: number } = {},
): Promise<RefundReconcileSummary> {
  const summary = { checked: 0, sent: 0, completed: 0, failed: 0, unavailable: 0 };
  const provider = onlineProvider();

  if (!provider) return summary;

  const now = options.now ?? new Date();
  const pending = await prisma.refund.findMany({
    where: {
      status: 'PENDING',
      createdAt: { lte: new Date(now.getTime() - RECONCILE_GRACE_MS) },
      payment: { provider: provider.name, method: 'ONLINE' },
    },
    orderBy: { createdAt: 'asc' },
    take: options.limit ?? 100,
    select: { id: true, providerRefundRef: true },
  });

  for (const refund of pending) {
    summary.checked += 1;

    try {
      if (!refund.providerRefundRef) {
        const outcome = await sendRefund(refund.id);

        if (outcome === 'started') summary.sent += 1;
        else if (outcome === 'unknown') summary.unavailable += 1;
        else if (outcome === 'refused') summary.failed += 1;
        continue;
      }

      const state = await syncRefund(refund.id);

      if (state === 'refunded') summary.completed += 1;
      if (state === 'cancelled') summary.failed += 1;
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      summary.unavailable += 1;
    }
  }

  return summary;
}

/**
 * `POST /admin/orders/:orderId/refunds`. The key is scoped to the order, so it means "this refund
 * of this order": the same key and the same request is the same refund, and the same key with a
 * different amount or reason is refused rather than guessed at.
 */
export async function requestRefund(
  orderId: string,
  key: string,
  body: { amountMinor: number; reason: string },
  context: AdminActionContext,
): Promise<{ refund: RefundView; replayed: boolean }> {
  const scopedKey = `admin:${createHash('sha256').update(`${orderId}:${key}`).digest('hex')}`;

  const replay = async (): Promise<{ refund: RefundView; replayed: boolean } | null> => {
    const prior = await prisma.refund.findUnique({
      where: { idempotencyKey: scopedKey },
      select: REFUND_VIEW_SELECT,
    });

    if (!prior) return null;

    if (prior.amountMinor !== body.amountMinor || prior.reason !== body.reason) {
      throw idempotencyConflict();
    }

    return { refund: toRefundView(prior), replayed: true };
  };

  const earlier = await replay();

  if (earlier) {
    // The earlier attempt may have stopped before the provider answered: nudge it along.
    await sendRefund(earlier.refund.id);
    return replay().then((again) => again ?? earlier);
  }

  let created: { refund: RefundRow; mustSend: boolean };

  try {
    created = await withTransaction(
      async (tx) => {
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: { id: true, orderNumber: true },
        });

        if (!order) throw notFound('That order does not exist.');

        await lockOrder(tx, orderId);

        const result = await createRefundRow(tx, {
          orderId,
          orderNumber: order.orderNumber,
          amountMinor: body.amountMinor,
          reason: body.reason,
          idempotencyKey: scopedKey,
          requestedBy: context.actor,
        });

        if (!result) {
          throw conflict('Nothing has been paid on this order, so there is nothing to refund.');
        }

        await recordAudit(tx, {
          action: AuditAction.REFUND_REQUESTED,
          entityType: 'Order',
          entityId: orderId,
          actor: context.actor,
          after: {
            refundId: result.refund.id,
            amountMinor: body.amountMinor,
            reason: body.reason,
          },
          ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
          ...(context.requestId ? { requestId: context.requestId } : {}),
        });

        return result;
      },
      { label: 'refunds.request' },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await replay();
      if (raced) return raced;
    }

    throw error;
  }

  if (created.mustSend) {
    await sendRefund(created.refund.id);
  }

  const fresh = await prisma.refund.findUniqueOrThrow({
    where: { id: created.refund.id },
    select: REFUND_VIEW_SELECT,
  });

  return { refund: toRefundView(fresh), replayed: false };
}
