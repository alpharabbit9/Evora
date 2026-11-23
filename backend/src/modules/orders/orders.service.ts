import type {
  OrderPaymentStatus,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RefundStatus,
} from '@prisma/client';
import { ProductImageKind } from '@prisma/client';

import { notFound } from '../../http/errors.js';
import type { Pagination } from '../../http/schemas.js';
import { toSkipTake } from '../../http/schemas.js';
import { type ImageView, toImageView } from '../../lib/media.js';
import { prisma } from '../../lib/prisma.js';
import { readOption } from '../catalog/sizes.js';
import { canResumePayment } from '../payments/payment-state.js';
import { ADMIN_TRANSITIONS, canCustomerCancel } from './order-state.js';

/**
 * Read-only order access, split by who is asking (API_SPEC.md §6, commerce invariant 7).
 *
 * SCOPE: nothing in this file writes. Orders are created by the checkout module (M6), payments
 * change them through the payments module (M7), and people through `order-management.service.ts`
 * (M8).
 *
 * What was bought, and for how much, is read from the order's own snapshots and never from the
 * catalog (PRD §6 rule 9). The photo is the one thing read through to the product: it is not a
 * purchase fact, and it is simply absent if the product has lost it.
 *
 * `getOwnOrder` takes the user id into the query instead of loading by id and comparing
 * afterwards. There is no moment where the row is in hand but unauthorized, so the check
 * cannot be forgotten, and a foreign id is a 404 rather than a 403 — the response does not
 * confirm that someone else's order exists.
 */
export interface OrderItemView {
  readonly id: string;
  readonly productNameSnapshot: string;
  readonly skuSnapshot: string;
  readonly quantity: number;
  readonly color: string | null;
  readonly size: string | null;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly image: ImageView | null;
}

export interface OrderSummaryView {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly paymentStatus: OrderPaymentStatus;
  readonly paymentMethod: PaymentMethod;
  readonly currency: string;
  readonly totalMinor: number;
  readonly placedAt: Date;
}

export interface OrderDetailView extends OrderSummaryView {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number;
  readonly contact: { readonly email: string; readonly phone: string | null };
  readonly shipping: {
    readonly recipientName: string;
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly state: string | null;
    readonly postalCode: string;
    readonly countryCode: string;
    readonly method: string | null;
  };
  readonly items: readonly OrderItemView[];
  /** The online attempt, for the order page. `null` for cash on delivery. */
  readonly payment: {
    readonly id: string;
    readonly status: PaymentStatus;
    /** Whether the customer can still be sent to the gateway. */
    readonly canResume: boolean;
  } | null;
  /** The order's progress, oldest first: what happened and when, never who or why. */
  readonly timeline: readonly { readonly status: OrderStatus; readonly at: Date }[];
  /** Set once shipped, if the store recorded it. */
  readonly tracking: { readonly carrier: string | null; readonly number: string | null } | null;
  readonly refunds: readonly {
    readonly id: string;
    readonly amountMinor: number;
    readonly status: RefundStatus;
    readonly createdAt: Date;
  }[];
  /** Whether the customer may cancel it themselves now (ADR 0020). */
  readonly canCancel: boolean;
}

/** What an administrator sees beyond the customer's view (API_SPEC.md §8). */
export interface AdminOrderDetailView extends OrderDetailView {
  readonly customer: { readonly id: string | null; readonly email: string };
  readonly allowedTransitions: readonly OrderStatus[];
  readonly history: readonly {
    readonly fromStatus: OrderStatus | null;
    readonly toStatus: OrderStatus;
    readonly reason: string | null;
    readonly isSystem: boolean;
    readonly actorEmail: string | null;
    readonly at: Date;
  }[];
  readonly payments: readonly {
    readonly id: string;
    readonly provider: string;
    readonly method: PaymentMethod;
    readonly status: PaymentStatus;
    readonly amountMinor: number;
    /** Why a payment failed or is held: it can name a fraud hold, so it is admin-only. */
    readonly failureCode: string | null;
    readonly createdAt: Date;
  }[];
  readonly refundsDetail: readonly {
    readonly id: string;
    readonly paymentId: string;
    readonly amountMinor: number;
    readonly status: RefundStatus;
    readonly reason: string | null;
    readonly providerAcknowledged: boolean;
    readonly requestedByEmail: string | null;
    readonly createdAt: Date;
  }[];
}

/**
 * `guestAccessTokenHash`, `idempotencyKey` and `requestFingerprint` are never selected.
 * They are internal, and the guest token hash in particular is a credential.
 */
const SUMMARY_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  paymentStatus: true,
  paymentMethod: true,
  currency: true,
  totalMinor: true,
  placedAt: true,
} as const;

const DETAIL_SELECT = {
  ...SUMMARY_SELECT,
  subtotalMinor: true,
  discountMinor: true,
  shippingMinor: true,
  taxMinor: true,
  contactEmail: true,
  contactPhone: true,
  shipRecipientName: true,
  shipLine1: true,
  shipLine2: true,
  shipCity: true,
  shipState: true,
  shipPostalCode: true,
  shipCountryCode: true,
  shippingMethod: true,
  shippingCarrier: true,
  trackingNumber: true,
  payments: {
    where: { method: 'ONLINE' },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { id: true, status: true, createdAt: true },
  },
  statusHistory: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { toStatus: true, createdAt: true },
  },
  refunds: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, amountMinor: true, status: true, createdAt: true },
  },
  items: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      productNameSnapshot: true,
      skuSnapshot: true,
      variantOptionsSnapshot: true,
      quantity: true,
      unitPriceMinor: true,
      lineTotalMinor: true,
      product: {
        select: {
          images: {
            where: { kind: ProductImageKind.PHOTO },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            take: 1,
            select: { objectKey: true, altText: true, widthPx: true, heightPx: true },
          },
        },
      },
    },
  },
} satisfies Prisma.OrderSelect;

type OrderDetailRow = Prisma.OrderGetPayload<{ select: typeof DETAIL_SELECT }>;

function toDetailView(order: OrderDetailRow): OrderDetailView {
  const payment = order.payments[0];
  const tracking =
    order.shippingCarrier || order.trackingNumber
      ? { carrier: order.shippingCarrier, number: order.trackingNumber }
      : null;

  return {
    timeline: order.statusHistory.map((row) => ({ status: row.toStatus, at: row.createdAt })),
    tracking,
    // Mapped field by field: the admin query selects more on the same relation.
    refunds: order.refunds.map((refund) => ({
      id: refund.id,
      amountMinor: refund.amountMinor,
      status: refund.status,
      createdAt: refund.createdAt,
    })),
    // A payment held for review is being decided by a person: the customer waits for that.
    canCancel: canCustomerCancel(order.status) && payment?.status !== 'PROCESSING',
    payment: payment
      ? {
          id: payment.id,
          status: payment.status,
          canResume: canResumePayment({
            paymentStatus: payment.status,
            orderStatus: order.status,
            createdAt: payment.createdAt,
          }),
        }
      : null,
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    currency: order.currency,
    totalMinor: order.totalMinor,
    placedAt: order.placedAt,
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    shippingMinor: order.shippingMinor,
    taxMinor: order.taxMinor,
    contact: { email: order.contactEmail, phone: order.contactPhone },
    shipping: {
      recipientName: order.shipRecipientName,
      line1: order.shipLine1,
      line2: order.shipLine2,
      city: order.shipCity,
      state: order.shipState,
      postalCode: order.shipPostalCode,
      countryCode: order.shipCountryCode,
      method: order.shippingMethod,
    },
    items: order.items.map((item) => {
      const image = item.product?.images[0];

      return {
        id: item.id,
        productNameSnapshot: item.productNameSnapshot,
        skuSnapshot: item.skuSnapshot,
        quantity: item.quantity,
        color: readOption(item.variantOptionsSnapshot, 'color'),
        size: readOption(item.variantOptionsSnapshot, 'size'),
        unitPriceMinor: item.unitPriceMinor,
        lineTotalMinor: item.lineTotalMinor,
        image: image ? toImageView(image) : null,
      };
    }),
  };
}

export interface OrderPage {
  readonly items: readonly OrderSummaryView[];
  readonly total: number;
}

export async function listOwnOrders(userId: string, pagination: Pagination): Promise<OrderPage> {
  const { skip, take } = toSkipTake(pagination);

  const [items, total] = await Promise.all([
    prisma.order.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: SUMMARY_SELECT,
    }),
    prisma.order.count({ where: { userId } }),
  ]);

  return { items, total };
}

export async function getOwnOrder(userId: string, orderId: string): Promise<OrderDetailView> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    select: DETAIL_SELECT,
  });

  if (!order) {
    throw notFound('That order does not exist.');
  }

  return toDetailView(order);
}

/**
 * Admin read of any order. A separate function rather than a flag on `getOwnOrder`, so the
 * unscoped query only exists behind the admin route and cannot be reached by passing the
 * wrong argument.
 */
export async function getOrderForAdmin(orderId: string): Promise<AdminOrderDetailView> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      ...DETAIL_SELECT,
      userId: true,
      statusHistory: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          fromStatus: true,
          toStatus: true,
          reason: true,
          isSystem: true,
          createdAt: true,
          actor: { select: { email: true } },
        },
      },
      refunds: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          paymentId: true,
          amountMinor: true,
          status: true,
          reason: true,
          providerRefundRef: true,
          createdAt: true,
          requestedBy: { select: { email: true } },
        },
      },
    },
  });

  if (!order) {
    throw notFound('That order does not exist.');
  }

  const payments = await prisma.payment.findMany({
    where: { orderId },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      provider: true,
      method: true,
      status: true,
      amountMinor: true,
      failureCode: true,
      createdAt: true,
    },
  });

  return {
    ...toDetailView(order),
    customer: { id: order.userId, email: order.contactEmail },
    allowedTransitions: ADMIN_TRANSITIONS[order.status],
    history: order.statusHistory.map((row) => ({
      fromStatus: row.fromStatus,
      toStatus: row.toStatus,
      reason: row.reason,
      isSystem: row.isSystem,
      actorEmail: row.actor?.email ?? null,
      at: row.createdAt,
    })),
    payments,
    refundsDetail: order.refunds.map((refund) => ({
      id: refund.id,
      paymentId: refund.paymentId,
      amountMinor: refund.amountMinor,
      status: refund.status,
      reason: refund.reason,
      providerAcknowledged: refund.providerRefundRef !== null,
      requestedByEmail: refund.requestedBy?.email ?? null,
      createdAt: refund.createdAt,
    })),
  };
}

export interface AdminOrderFilters {
  readonly status?: OrderStatus;
  readonly paymentStatus?: OrderPaymentStatus;
  readonly paymentMethod?: PaymentMethod;
  /** Order number or contact email, case-insensitively. */
  readonly q?: string;
}

export interface AdminOrderSummaryView extends OrderSummaryView {
  readonly contactEmail: string;
  readonly itemCount: number;
}

export async function listOrdersForAdmin(
  pagination: Pagination,
  filters: AdminOrderFilters,
): Promise<{ items: readonly AdminOrderSummaryView[]; total: number }> {
  const { skip, take } = toSkipTake(pagination);
  const where: Prisma.OrderWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.paymentStatus ? { paymentStatus: filters.paymentStatus } : {}),
    ...(filters.paymentMethod ? { paymentMethod: filters.paymentMethod } : {}),
    ...(filters.q
      ? {
          OR: [
            { orderNumber: { contains: filters.q, mode: 'insensitive' } },
            { contactEmail: { contains: filters.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: { ...SUMMARY_SELECT, contactEmail: true, items: { select: { quantity: true } } },
    }),
    prisma.order.count({ where }),
  ]);

  return {
    items: rows.map(({ items, ...row }) => ({
      ...row,
      itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    })),
    total,
  };
}
