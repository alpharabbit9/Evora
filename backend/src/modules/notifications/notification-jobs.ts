import { z } from 'zod';

import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { PermanentJobError, isScrubbed } from '../jobs/job-policy.js';
import type { JobHandler, JobResult } from '../jobs/job-types.js';
import { getStoreSettings } from '../settings/settings.service.js';
import { AUTH_LINK_TTL_MS, type AuthEmailType } from './auth-email.js';
import {
  type OrderSummaryView,
  type RenderedEmail,
  cancelledEmail,
  lowStockEmail,
  passwordResetEmail,
  paymentReviewEmail,
  receiptEmail,
  refundEmail,
  shippingEmail,
  verificationEmail,
} from './templates.js';

/**
 * The email jobs (ADR 0021): one handler per outbox type that becomes a message. Each reads the
 * current state of what it is about, decides whether the message still makes sense, renders it
 * and hands it to the transport. Payloads hold identifiers, not addresses (checkout.service.ts),
 * so the recipient is whoever the order or account names when the message is sent.
 *
 * A payload that does not parse, or names something that no longer exists, is a permanent
 * failure: retrying cannot make it appear.
 */
function parsePayload<T extends z.ZodType>(schema: T, payload: unknown): z.output<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new PermanentJobError('The job payload is not valid for its type');
  return parsed.data;
}

const frontend = (pathname: string) => new URL(pathname, env.FRONTEND_ORIGIN).toString();

/** Read at send time, so a renamed store or a new support address applies to queued mail too. */
async function storeIdentity() {
  const settings = await getStoreSettings();
  return { storeName: settings.storeName, supportEmail: settings.supportEmail };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  userId: true,
  status: true,
  paymentMethod: true,
  paymentStatus: true,
  currency: true,
  contactEmail: true,
  shipRecipientName: true,
  user: { select: { name: true } },
} as const;

async function loadOrder(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: ORDER_SELECT });
  if (!order) throw new PermanentJobError('The order no longer exists');
  return order;
}

type OrderHead = Awaited<ReturnType<typeof loadOrder>>;

async function summaryOf(order: OrderHead): Promise<OrderSummaryView> {
  return {
    ...(await storeIdentity()),
    orderNumber: order.orderNumber,
    // Signed-in orders have a page; a guest order would need its access token, which v1 never takes.
    orderUrl: order.userId ? frontend(`/orders/${encodeURIComponent(order.id)}`) : null,
    recipientName: order.user?.name ?? order.shipRecipientName,
  };
}

async function sendToCustomer(
  order: OrderHead,
  email: RenderedEmail,
  idempotencyKey: string,
  context: Parameters<JobHandler>[1],
): Promise<JobResult> {
  await context.transport.send({ to: [order.contactEmail], ...email, idempotencyKey });
  return undefined;
}

const orderPayload = z.object({ orderId: z.string().min(1) });

function optionsText(snapshot: unknown): string | null {
  if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) return null;
  const values = Object.values(snapshot as Record<string, unknown>).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  return values.length > 0 ? values.join(' / ') : null;
}

const sendReceipt: JobHandler = async (job, context) => {
  const { orderId } = parsePayload(orderPayload, job.payload);
  const order = await loadOrder(orderId);

  // An outage can hold a receipt back past a cancellation. A "thank you for your order" arriving
  // after "your order was cancelled" would only confuse.
  if (order.status === 'CANCELLED' || order.status === 'PAYMENT_FAILED') {
    return { skipped: 'The order closed before its receipt was sent' };
  }

  const detail = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      subtotalMinor: true,
      discountMinor: true,
      shippingMinor: true,
      taxMinor: true,
      totalMinor: true,
      shipLine1: true,
      shipLine2: true,
      shipCity: true,
      shipState: true,
      shipPostalCode: true,
      shipCountryCode: true,
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          productNameSnapshot: true,
          variantOptionsSnapshot: true,
          quantity: true,
          lineTotalMinor: true,
        },
      },
    },
  });

  const email = receiptEmail({
    ...(await summaryOf(order)),
    paymentMethod: order.paymentMethod === 'ONLINE' ? 'ONLINE' : 'COD',
    currency: order.currency,
    items: detail.items.map((item) => ({
      name: item.productNameSnapshot,
      options: optionsText(item.variantOptionsSnapshot),
      quantity: item.quantity,
      lineTotalMinor: item.lineTotalMinor,
    })),
    subtotalMinor: detail.subtotalMinor,
    discountMinor: detail.discountMinor,
    shippingMinor: detail.shippingMinor,
    taxMinor: detail.taxMinor,
    totalMinor: detail.totalMinor,
    shipTo: [
      order.shipRecipientName,
      detail.shipLine1,
      detail.shipLine2,
      detail.shipCity,
      detail.shipState,
      detail.shipPostalCode,
      detail.shipCountryCode,
    ].filter((line): line is string => Boolean(line)),
  });

  return sendToCustomer(order, email, job.dedupeKey, context);
};

const shippingPayload = orderPayload.extend({ status: z.enum(['SHIPPED', 'DELIVERED']) });

const sendShippingUpdate: JobHandler = async (job, context) => {
  const { orderId, status } = parsePayload(shippingPayload, job.payload);
  const order = await loadOrder(orderId);

  if (order.status === 'CANCELLED') {
    return { skipped: 'The order was cancelled before this update was sent' };
  }

  const tracking = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { shippingCarrier: true, trackingNumber: true },
  });

  const email = shippingEmail({
    ...(await summaryOf(order)),
    status,
    carrier: tracking.shippingCarrier,
    trackingNumber: tracking.trackingNumber,
  });

  return sendToCustomer(order, email, job.dedupeKey, context);
};

const PAID_ONLINE = new Set(['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED']);

const sendCancellation: JobHandler = async (job, context) => {
  const { orderId } = parsePayload(orderPayload, job.payload);
  const order = await loadOrder(orderId);

  const email = cancelledEmail({
    ...(await summaryOf(order)),
    paidOnline: order.paymentMethod === 'ONLINE' && PAID_ONLINE.has(order.paymentStatus),
  });

  return sendToCustomer(order, email, job.dedupeKey, context);
};

const refundPayload = z.object({
  refundId: z.string().min(1),
  stage: z.enum(['requested', 'succeeded']).optional(),
});

/** Rows written before `stage` was added carry it only in their key (`refund-update:<id>:<stage>`). */
function refundStage(dedupeKey: string, stage: 'requested' | 'succeeded' | undefined) {
  if (stage) return stage;
  if (dedupeKey.endsWith(':succeeded')) return 'succeeded';
  if (dedupeKey.endsWith(':requested')) return 'requested';
  throw new PermanentJobError('The refund update does not say what happened');
}

const sendRefundUpdate: JobHandler = async (job, context) => {
  const payload = parsePayload(refundPayload, job.payload);
  const stage = refundStage(job.dedupeKey, payload.stage);
  const refund = await prisma.refund.findUnique({
    where: { id: payload.refundId },
    select: {
      status: true,
      amountMinor: true,
      currency: true,
      orderId: true,
      payment: { select: { method: true } },
    },
  });

  if (!refund) throw new PermanentJobError('The refund no longer exists');

  // A refund the provider refused is a person's to sort out (a review alert is already queued);
  // telling the customer it has started would be untrue.
  if (stage === 'requested' && refund.status === 'FAILED') {
    return { skipped: 'The refund failed before this update was sent' };
  }

  const order = await loadOrder(refund.orderId);
  const email = refundEmail({
    ...(await summaryOf(order)),
    stage,
    amountMinor: refund.amountMinor,
    currency: refund.currency,
    cash: refund.payment.method === 'COD',
  });

  return sendToCustomer(order, email, job.dedupeKey, context);
};

// ---------------------------------------------------------------------------
// Account links
// ---------------------------------------------------------------------------

const authPayload = z.object({
  userId: z.string().min(1),
  email: z.email(),
  name: z.string(),
  url: z.url(),
});

function authLinkHandler(type: AuthEmailType): JobHandler {
  return async (job, context) => {
    if (isScrubbed(job.payload)) {
      throw new PermanentJobError('The link was already removed from this job');
    }

    const payload = parsePayload(authPayload, job.payload);

    // Sending a link that no longer works would only send the customer to an error page.
    if (context.now.getTime() - job.createdAt.getTime() > AUTH_LINK_TTL_MS[type]) {
      throw new PermanentJobError('The link expired before it could be sent');
    }

    const view = { ...(await storeIdentity()), recipientName: payload.name, url: payload.url };
    const email = type === 'PASSWORD_RESET' ? passwordResetEmail(view) : verificationEmail(view);

    await context.transport.send({ to: [payload.email], ...email, idempotencyKey: job.dedupeKey });
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Staff alerts
// ---------------------------------------------------------------------------

/** STAFF_ALERT_EMAILS, or else every active administrator. */
export async function staffRecipients(): Promise<string[]> {
  if (env.STAFF_ALERT_EMAILS.length > 0) return env.STAFF_ALERT_EMAILS;

  const admins = await prisma.user.findMany({
    where: { role: { in: ['ADMIN', 'SUPERADMIN'] }, status: 'ACTIVE' },
    select: { email: true },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });

  return admins.map((admin) => admin.email);
}

async function sendToStaff(
  email: RenderedEmail,
  idempotencyKey: string,
  context: Parameters<JobHandler>[1],
): Promise<JobResult> {
  const to = await staffRecipients();

  // Visible on the dashboard as DEAD rather than quietly "sent" to nobody.
  if (to.length === 0) {
    throw new PermanentJobError('No one to alert: set STAFF_ALERT_EMAILS or add an administrator');
  }

  await context.transport.send({ to, ...email, idempotencyKey });
  return undefined;
}

const lowStockPayload = z.object({
  variantId: z.string().min(1),
  sku: z.string().min(1),
  currentStock: z.number().int(),
  threshold: z.number().int(),
});

const sendLowStockAlert: JobHandler = async (job, context) => {
  const payload = parsePayload(lowStockPayload, job.payload);
  const variant = await prisma.productVariant.findUnique({
    where: { id: payload.variantId },
    select: { stockQuantity: true, product: { select: { name: true } } },
  });

  const email = lowStockEmail({
    ...(await storeIdentity()),
    productName: variant?.product.name ?? null,
    sku: payload.sku,
    stockAtAlert: payload.currentStock,
    stockNow: variant?.stockQuantity ?? null,
    threshold: payload.threshold,
    inventoryUrl: frontend(`/admin/inventory?q=${encodeURIComponent(payload.sku)}`),
  });

  return sendToStaff(email, job.dedupeKey, context);
};

const reviewPayload = z.object({
  orderId: z.string().min(1),
  orderNumber: z.string().min(1),
  reason: z.string().min(1).max(80),
});

const sendPaymentReview: JobHandler = async (job, context) => {
  const payload = parsePayload(reviewPayload, job.payload);
  const email = paymentReviewEmail({
    ...(await storeIdentity()),
    orderNumber: payload.orderNumber,
    reason: payload.reason,
    adminOrderUrl: frontend(`/admin/orders/${encodeURIComponent(payload.orderId)}`),
  });

  return sendToStaff(email, job.dedupeKey, context);
};

export const notificationHandlers = {
  ORDER_RECEIPT: sendReceipt,
  SHIPPING_UPDATE: sendShippingUpdate,
  ORDER_CANCELLED: sendCancellation,
  REFUND_UPDATE: sendRefundUpdate,
  PASSWORD_RESET: authLinkHandler('PASSWORD_RESET'),
  EMAIL_VERIFICATION: authLinkHandler('EMAIL_VERIFICATION'),
  LOW_STOCK_ALERT: sendLowStockAlert,
  PAYMENT_REVIEW_REQUIRED: sendPaymentReview,
} satisfies Record<string, JobHandler>;
