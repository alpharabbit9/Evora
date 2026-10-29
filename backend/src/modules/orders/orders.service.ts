import type { OrderPaymentStatus, OrderStatus, PaymentMethod } from '@prisma/client';

import { notFound } from '../../http/errors.js';
import type { Pagination } from '../../http/schemas.js';
import { toSkipTake } from '../../http/schemas.js';
import { prisma } from '../../lib/prisma.js';

/**
 * Read-only order access, split by who is asking (API_SPEC.md §6, commerce invariant 7).
 *
 * SCOPE: this is the authorization slice of orders, not the orders module. Checkout (M6),
 * payments (M7) and fulfilment transitions (M8) are not here and nothing in this file
 * writes. It exists so "a customer can read their own order and nobody else's" is enforced
 * and tested now, rather than being bolted on when checkout lands.
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
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
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
  readonly items: readonly OrderItemView[];
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
  items: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      productNameSnapshot: true,
      skuSnapshot: true,
      quantity: true,
      unitPriceMinor: true,
      lineTotalMinor: true,
    },
  },
} as const;

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

  return order;
}

/**
 * Admin read of any order. A separate function rather than a flag on `getOwnOrder`, so the
 * unscoped query only exists behind the admin route and cannot be reached by passing the
 * wrong argument.
 */
export async function getOrderForAdmin(orderId: string): Promise<OrderDetailView> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: DETAIL_SELECT });

  if (!order) {
    throw notFound('That order does not exist.');
  }

  return order;
}
