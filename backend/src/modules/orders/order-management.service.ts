import type { OrderStatus } from '@prisma/client';

import { conflict, notFound, paymentPending, validationFailed } from '../../http/errors.js';
import type { Actor } from '../../http/guards.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { type TransactionClient, withTransaction } from '../../lib/transaction.js';
import type { AdminActionContext } from '../admin/customers.service.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';
import { releaseCoupon } from '../coupons/coupons.service.js';
import { releaseStock } from '../inventory/inventory.service.js';
import { acceptHeldPayment, syncPayment } from '../payments/payments.service.js';
import { ProviderUnavailableError } from '../payments/provider.js';
import { providerByName } from '../payments/provider-registry.js';
import {
  createRefundRow,
  lockOrder,
  requestReview,
  sendRefund,
} from '../refunds/refunds.service.js';
import { canCustomerCancel, canTransition } from './order-state.js';
import {
  type AdminOrderDetailView,
  type OrderDetailView,
  getOrderForAdmin,
  getOwnOrder,
} from './orders.service.js';

/**
 * People changing orders (ADR 0020): a customer cancelling, an administrator moving an order
 * through fulfilment, recording cash collected, or resolving a held payment.
 *
 * Every change takes the order row lock first, the same lock payment news takes (ADR 0019), so a
 * cancellation and a payment arriving at the same moment take turns: the second sees what the
 * first committed. Each re-checks the status after taking the lock, because what was read before
 * it may already be out of date.
 *
 * Provider calls never happen inside these transactions. A cancellation that needs a refund
 * writes the refund row with the order, and the provider is asked after commit (refunds.service).
 */

function auditContext(context: AdminActionContext) {
  return {
    actor: context.actor,
    ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
    ...(context.requestId ? { requestId: context.requestId } : {}),
  };
}

const LOCKED_ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentMethod: true,
  items: { select: { variantId: true, quantity: true } },
} as const;

interface LockedOrder {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly items: readonly { readonly variantId: string | null; readonly quantity: number }[];
}

async function lockAndLoad(tx: TransactionClient, orderId: string): Promise<LockedOrder> {
  await lockOrder(tx, orderId);

  const order = await tx.order.findUnique({ where: { id: orderId }, select: LOCKED_ORDER_SELECT });

  if (!order) throw notFound('That order does not exist.');

  return order;
}

/**
 * Closes an order, inside the caller's transaction, with the row locked. Puts the goods back on
 * sale, stops a payment that has not happened, and books a full refund of one that has.
 *
 * @returns the refund to send after commit, if any.
 */
async function closeOrder(
  tx: TransactionClient,
  order: LockedOrder,
  by: { actor?: Actor; reason: string },
): Promise<string | null> {
  const payment = await tx.payment.findFirst({
    where: { orderId: order.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });

  let paymentStatus: 'UNPAID' | undefined;

  if (payment?.status === 'PENDING') {
    // Not paid, and now it will not be. Money that still arrives is caught by the payment state
    // machine as "paid after close" and flagged for a refund (ADR 0019).
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: 'CANCELLED', failureCode: 'ORDER_CANCELLED' },
    });
    paymentStatus = 'UNPAID';
  }

  await tx.order.update({
    where: { id: order.id },
    data: { status: 'CANCELLED', ...(paymentStatus ? { paymentStatus } : {}) },
  });
  await tx.orderStatusHistory.create({
    data: {
      orderId: order.id,
      fromStatus: order.status,
      toStatus: 'CANCELLED',
      ...(by.actor ? { actorUserId: by.actor.id } : { isSystem: true }),
      reason: by.reason,
    },
  });

  // Compensation for decrement-on-order (ADR 0004). The ledger says what the order still holds, so
  // an order whose stock already went back (a failed payment) releases nothing twice.
  await releaseStock(
    tx,
    order.items.flatMap((item) =>
      item.variantId ? [{ variantId: item.variantId, quantity: item.quantity }] : [],
    ),
    order.id,
    'ORDER_CANCELLED',
  );
  // After the stock (lock order, `modules/coupons`): the coupon use is given back.
  await releaseCoupon(tx, order.id);

  await tx.outboxEvent.createMany({
    data: [
      {
        eventType: 'ORDER_CANCELLED',
        dedupeKey: `order-cancelled:${order.id}`,
        payload: { orderId: order.id, orderNumber: order.orderNumber },
      },
    ],
    skipDuplicates: true,
  });

  if (payment?.status === 'PROCESSING') {
    // Money arrived but was held (wrong amount or risk). What to give back is a person's call.
    await requestReview(
      tx,
      { id: payment.id, orderId: order.id, orderNumber: order.orderNumber },
      'CANCELLED_WHILE_HELD',
    );
    return null;
  }

  const refund = await createRefundRow(tx, {
    orderId: order.id,
    orderNumber: order.orderNumber,
    reason: `Order cancelled: ${by.reason}`.slice(0, 255),
    idempotencyKey: `cancel:${order.id}`,
    ...(by.actor ? { requestedBy: by.actor } : {}),
  });

  return refund?.mustSend ? refund.refund.id : null;
}

/** After commit: the provider call. A failure leaves the refund pending for the sweep. */
async function sendAfterCommit(refundId: string | null): Promise<void> {
  if (!refundId) return;

  try {
    await sendRefund(refundId);
  } catch (error) {
    logger.error({ err: error, refundId }, 'Could not send a refund; the sweep will retry it');
  }
}

/**
 * `POST /orders/:orderId/cancel`. Repeating it on a cancelled order returns that order: the
 * customer wanted it cancelled, and it is.
 */
export async function cancelOwnOrder(
  actor: Actor,
  orderId: string,
  reason: string | undefined,
): Promise<OrderDetailView> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId: actor.id },
    select: {
      status: true,
      paymentMethod: true,
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, provider: true, status: true },
      },
    },
  });

  if (!order) throw notFound('That order does not exist.');

  if (order.status === 'CANCELLED') return getOwnOrder(actor.id, orderId);

  // The customer may have paid seconds ago and the notification not have arrived. Ask first, so a
  // paid order is cancelled with a refund rather than being cancelled as unpaid and the money then
  // being flagged as late. Best effort: if the provider cannot say, the late path still catches it.
  const payment = order.payments[0];
  const provider = payment ? providerByName(payment.provider) : null;

  if (order.status === 'PENDING_PAYMENT' && payment?.status === 'PENDING' && provider) {
    try {
      await syncPayment(provider, payment.id);
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
    }
  }

  const refundId = await withTransaction(
    async (tx) => {
      const locked = await lockAndLoad(tx, orderId);

      if (locked.status === 'CANCELLED') return null;

      const latest = await tx.payment.findFirst({
        where: { orderId },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      });

      if (latest?.status === 'PROCESSING') {
        throw paymentPending(
          'We have your payment and are checking it, so the order cannot be cancelled yet.',
        );
      }

      if (!canCustomerCancel(locked.status)) {
        throw conflict(
          locked.status === 'PAYMENT_FAILED'
            ? 'This order was already closed without payment.'
            : 'This order is already being prepared, so it can no longer be cancelled here. Please contact us.',
        );
      }

      return closeOrder(tx, locked, {
        actor,
        reason: reason ? `Cancelled by the customer: ${reason}` : 'Cancelled by the customer',
      });
    },
    { label: 'orders.cancelOwn' },
  );

  await sendAfterCommit(refundId);

  return getOwnOrder(actor.id, orderId);
}

export interface TransitionInput {
  readonly from: OrderStatus;
  readonly to: OrderStatus;
  readonly note?: string | undefined;
  readonly carrier?: string | undefined;
  readonly trackingNumber?: string | undefined;
}

/**
 * `POST /admin/orders/:orderId/transitions`. `from` is the status the administrator was looking
 * at: if the order moved since (another admin, a payment), the request is refused rather than
 * applied to an order they have not seen. Repeating a transition that already happened returns
 * the order unchanged, so a retried click is harmless.
 */
export async function transitionOrder(
  orderId: string,
  input: TransitionInput,
  context: AdminActionContext,
): Promise<AdminOrderDetailView> {
  if (!canTransition(input.from, input.to)) {
    throw validationFailed([
      { field: 'to', issue: `An order cannot move from ${input.from} to ${input.to}` },
    ]);
  }

  const refundId = await withTransaction(
    async (tx) => {
      const order = await lockAndLoad(tx, orderId);

      if (order.status === input.to) return null;

      if (order.status !== input.from) {
        throw conflict(`This order is now ${order.status}. Reload it before changing it.`, {
          details: [{ field: 'from', issue: `The order is ${order.status}` }],
        });
      }

      const reason = input.note ?? null;
      let pendingRefund: string | null = null;

      if (input.to === 'CANCELLED') {
        pendingRefund = await closeOrder(tx, order, {
          actor: context.actor,
          reason: reason ?? 'Cancelled by the store',
        });
      } else {
        const tracking =
          input.to === 'SHIPPED'
            ? {
                ...(input.carrier ? { shippingCarrier: input.carrier } : {}),
                ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
              }
            : {};

        await tx.order.update({ where: { id: orderId }, data: { status: input.to, ...tracking } });
        await tx.orderStatusHistory.create({
          data: {
            orderId,
            fromStatus: order.status,
            toStatus: input.to,
            actorUserId: context.actor.id,
            reason,
          },
        });

        if (input.to === 'SHIPPED' || input.to === 'DELIVERED') {
          await tx.outboxEvent.createMany({
            data: [
              {
                eventType: 'SHIPPING_UPDATE',
                dedupeKey: `shipping-update:${orderId}:${input.to}`,
                payload: { orderId, orderNumber: order.orderNumber, status: input.to },
              },
            ],
            skipDuplicates: true,
          });
        }
      }

      await recordAudit(tx, {
        action: AuditAction.ORDER_TRANSITIONED,
        entityType: 'Order',
        entityId: orderId,
        before: { status: order.status },
        after: {
          status: input.to,
          ...(input.note ? { note: input.note } : {}),
          ...(input.carrier ? { carrier: input.carrier } : {}),
          ...(input.trackingNumber ? { trackingNumber: input.trackingNumber } : {}),
        },
        ...auditContext(context),
      });

      return pendingRefund;
    },
    { label: 'orders.transition' },
  );

  await sendAfterCommit(refundId);

  return getOrderForAdmin(orderId);
}

/**
 * `POST /admin/orders/:orderId/cod-collection`: the courier has the cash. Collection is its own
 * fact (API_SPEC.md §9), recorded explicitly rather than assumed from "delivered", because a
 * delivered order whose cash never arrived is exactly what the store needs to be able to see.
 */
export async function recordCodCollection(
  orderId: string,
  context: AdminActionContext,
): Promise<AdminOrderDetailView> {
  await withTransaction(
    async (tx) => {
      const order = await lockAndLoad(tx, orderId);
      const full = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { paymentMethod: true, paymentStatus: true },
      });

      if (full.paymentMethod !== 'COD') {
        throw conflict('This order was not paid by cash on delivery.');
      }

      if (full.paymentStatus === 'COD_COLLECTED') return;

      if (order.status !== 'SHIPPED' && order.status !== 'DELIVERED') {
        throw conflict('Cash can be recorded only once the order has shipped.');
      }

      const payment = await tx.payment.findFirst({
        where: { orderId, method: 'COD', status: 'PENDING' },
        select: { id: true },
      });

      if (!payment) throw conflict('This order has no cash payment waiting to be collected.');

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: 'SUCCEEDED', capturedAt: new Date() },
      });
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus: 'COD_COLLECTED' } });
      await recordAudit(tx, {
        action: AuditAction.ORDER_COD_COLLECTED,
        entityType: 'Order',
        entityId: orderId,
        before: { paymentStatus: full.paymentStatus },
        after: { paymentStatus: 'COD_COLLECTED' },
        ...auditContext(context),
      });
    },
    { label: 'orders.codCollection' },
  );

  return getOrderForAdmin(orderId);
}

/**
 * `POST /admin/payments/:paymentId/hold-resolution`: a person decides a payment the state
 * machine held (ADR 0019 decision 10).
 *
 *  - accept: only a risk hold. The payment was for the right amount, so the order completes.
 *  - reject: the order is cancelled and its goods go back on sale. A risk hold was paid in full,
 *    so the payment is recorded and refunded through the provider. An amount-mismatch hold was not
 *    paid as charged, so what to return cannot be computed here; it stays flagged for a person to
 *    settle in the provider's panel.
 */
export async function resolveHeldPayment(
  paymentId: string,
  decision: 'accept' | 'reject',
  note: string,
  context: AdminActionContext,
): Promise<AdminOrderDetailView> {
  const head = await prisma.payment.findUnique({
    where: { id: paymentId },
    select: { orderId: true },
  });

  if (!head) throw notFound('That payment does not exist.');

  const refundId = await withTransaction(
    async (tx) => {
      const order = await lockAndLoad(tx, head.orderId);
      const payment = await tx.payment.findUniqueOrThrow({
        where: { id: paymentId },
        select: { status: true, failureCode: true },
      });

      if (payment.status !== 'PROCESSING') {
        throw conflict('This payment is not waiting for a decision.');
      }

      let pendingRefund: string | null = null;

      if (decision === 'accept') {
        if (payment.failureCode !== 'RISK_REVIEW') {
          throw conflict(
            'Only a payment held for risk can be accepted. One for the wrong amount was not paid in full.',
          );
        }

        if (!(await acceptHeldPayment(tx, paymentId))) {
          throw conflict('This payment can no longer be accepted.');
        }
      } else {
        if (payment.failureCode === 'RISK_REVIEW') {
          // The money arrived as charged: record it, so the cancellation refunds it.
          await tx.payment.update({
            where: { id: paymentId },
            data: { status: 'SUCCEEDED', capturedAt: new Date() },
          });
          await tx.order.update({ where: { id: order.id }, data: { paymentStatus: 'PAID' } });
        }

        pendingRefund = await closeOrder(tx, order, {
          actor: context.actor,
          reason: `Held payment rejected: ${note}`.slice(0, 500),
        });
      }

      await recordAudit(tx, {
        action: AuditAction.PAYMENT_HOLD_RESOLVED,
        entityType: 'Payment',
        entityId: paymentId,
        before: { status: 'PROCESSING', hold: payment.failureCode ?? 'unknown' },
        after: { decision, note },
        ...auditContext(context),
      });

      return pendingRefund;
    },
    { label: 'orders.resolveHold' },
  );

  await sendAfterCommit(refundId);

  return getOrderForAdmin(head.orderId);
}
