import { OrderStatus } from '@prisma/client';
import { z } from 'zod';

import { validationFailed } from '../../http/errors.js';
import { minorToDecimal, toCsv } from '../../lib/csv.js';
import { prisma } from '../../lib/prisma.js';
import { withTransaction } from '../../lib/transaction.js';
import type { AdminActionContext } from '../admin/customers.service.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';
import { assertBounded } from './analytics.service.js';
import { dateRangeQuery, resolveRange } from './date-range.js';

/**
 * `GET /admin/reports/orders.csv` (M10, ADR 0022): orders placed in a date range, one row each.
 *
 * Bounded twice: the range is at most `MAX_RANGE_DAYS`, and an export that would exceed
 * `MAX_EXPORT_ROWS` is refused with a request to narrow it, rather than truncated without saying.
 * The file holds customers' email addresses and cities, so every export is audited with who took it
 * and what it covered. Street addresses and phone numbers are left out: an order list does not
 * need them, and the order page has them when a person does.
 */
export const MAX_EXPORT_ROWS = 10_000;

export const orderExportQuery = z
  .object({ status: z.enum(OrderStatus).optional() })
  .and(dateRangeQuery);

const HEADER = [
  'order_number',
  'placed_at_utc',
  'status',
  'payment_status',
  'payment_method',
  'currency',
  'subtotal',
  'discount',
  'shipping',
  'tax',
  'total',
  'coupon_code',
  'items',
  'customer_email',
  'ship_city',
  'ship_country',
] as const;

export interface OrderExport {
  readonly filename: string;
  readonly csv: string;
  readonly rows: number;
}

export async function exportOrders(
  query: z.output<typeof orderExportQuery>,
  context: AdminActionContext,
): Promise<OrderExport> {
  const range = resolveRange(query, { defaultDays: 30 });
  assertBounded(range);

  const where = {
    createdAt: { gte: range.start, lt: range.end },
    ...(query.status ? { status: query.status } : {}),
  };

  const count = await prisma.order.count({ where });
  if (count > MAX_EXPORT_ROWS) {
    throw validationFailed(
      [
        {
          field: 'from',
          issue: `More than ${String(MAX_EXPORT_ROWS)} orders; choose a shorter range`,
        },
      ],
      `That range has ${String(count)} orders. Exports are limited to ${String(MAX_EXPORT_ROWS)}; choose a shorter range.`,
    );
  }

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    take: MAX_EXPORT_ROWS,
    select: {
      orderNumber: true,
      createdAt: true,
      status: true,
      paymentStatus: true,
      paymentMethod: true,
      currency: true,
      subtotalMinor: true,
      discountMinor: true,
      shippingMinor: true,
      taxMinor: true,
      totalMinor: true,
      couponCodeSnapshot: true,
      contactEmail: true,
      shipCity: true,
      shipCountryCode: true,
      items: { select: { quantity: true } },
    },
  });

  const csv = toCsv(
    HEADER,
    orders.map((order) => [
      order.orderNumber,
      order.createdAt.toISOString(),
      order.status,
      order.paymentStatus,
      order.paymentMethod,
      order.currency,
      minorToDecimal(order.subtotalMinor),
      minorToDecimal(order.discountMinor),
      minorToDecimal(order.shippingMinor),
      minorToDecimal(order.taxMinor),
      minorToDecimal(order.totalMinor),
      order.couponCodeSnapshot,
      order.items.reduce((sum, item) => sum + item.quantity, 0),
      order.contactEmail,
      order.shipCity,
      order.shipCountryCode,
    ]),
  );

  await withTransaction(
    (tx) =>
      recordAudit(tx, {
        action: AuditAction.ORDERS_EXPORTED,
        entityType: 'Order',
        entityId: 'export',
        actor: context.actor,
        after: {
          from: range.from,
          to: range.to,
          status: query.status ?? null,
          rows: orders.length,
        },
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      }),
    { label: 'reports.exportOrders' },
  );

  return {
    filename: `orders-${range.from}-to-${range.to}.csv`,
    csv,
    rows: orders.length,
  };
}
