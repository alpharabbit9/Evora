import type { OrderStatus } from '@prisma/client';

import { env } from '../../config/env.js';
import { validationFailed } from '../../http/errors.js';
import { prisma } from '../../lib/prisma.js';
import { type DayRange, MAX_RANGE_DAYS, STORE_OFFSET_MINUTES, listDays } from './date-range.js';

/**
 * The admin overview (M10, ADR 0022): what sold, for a bounded date range.
 *
 * Definitions, so the numbers mean one thing everywhere:
 *  - an order is *counted* once it is a real sale: CONFIRMED, PROCESSING, SHIPPED or DELIVERED.
 *    Awaiting payment, cancelled and payment-failed orders are not sales. A cancelled order that had
 *    been paid shows up as its refund, not as a negative sale;
 *  - *sales* is what counted orders were charged (`total_minor`: after discount, with delivery
 *    and tax), by the day the order was placed;
 *  - *refunds* is what was refunded (SUCCEEDED) in the range, by the day it was recorded;
 *  - *net* = sales − refunds.
 *
 * Query cost (reviewed with EXPLAIN on the development catalog): every query is bounded by the
 * range (at most `MAX_RANGE_DAYS`) and starts from an index — `orders_created_at_idx` for orders,
 * `order_items_order_id_idx` for their lines, `refunds_status_idx` for refunds. Aggregation is in
 * PostgreSQL, so the API reads tens of rows whatever the order volume. Nothing here runs during
 * checkout, and it takes no locks.
 */
const COUNTED: readonly OrderStatus[] = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

export interface Overview {
  readonly range: { readonly from: string; readonly to: string };
  readonly currency: string;
  readonly ordersPlaced: number;
  readonly ordersCounted: number;
  readonly salesMinor: number;
  readonly refundsMinor: number;
  readonly netMinor: number;
  readonly discountsMinor: number;
  readonly averageOrderMinor: number | null;
  readonly byStatus: Readonly<Partial<Record<OrderStatus, number>>>;
  readonly daily: readonly {
    readonly date: string;
    readonly orders: number;
    readonly salesMinor: number;
  }[];
  readonly topProducts: readonly {
    readonly productId: string | null;
    readonly name: string;
    readonly units: number;
    readonly salesMinor: number;
  }[];
  readonly lowStockVariants: number;
  readonly recentOrders: readonly {
    readonly id: string;
    readonly orderNumber: string;
    readonly status: OrderStatus;
    readonly totalMinor: number;
    readonly createdAt: Date;
  }[];
}

export function assertBounded(range: DayRange): void {
  if (range.days > MAX_RANGE_DAYS) {
    throw validationFailed([
      { field: 'from', issue: `A report can cover at most ${String(MAX_RANGE_DAYS)} days` },
    ]);
  }
}

const n = (value: bigint | number | null | undefined) => Number(value ?? 0);

export async function getOverview(range: DayRange): Promise<Overview> {
  assertBounded(range);
  const { start, end } = range;
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // `created_at` is UTC `timestamp(3)`; the bounds are compared in UTC whatever the session zone.
  const [statusRows, totalsRow, dailyRows, productRows, refundRow, lowStock, recent] =
    await Promise.all([
      prisma.$queryRaw<{ status: OrderStatus; count: bigint }[]>`
        SELECT status, COUNT(*) AS count
        FROM orders
        WHERE created_at >= (${startIso}::timestamptz AT TIME ZONE 'UTC')
          AND created_at <  (${endIso}::timestamptz AT TIME ZONE 'UTC')
        GROUP BY status
      `,
      prisma.$queryRaw<{ orders: bigint; sales: bigint | null; discounts: bigint | null }[]>`
        SELECT COUNT(*) AS orders, SUM(total_minor) AS sales, SUM(discount_minor) AS discounts
        FROM orders
        WHERE created_at >= (${startIso}::timestamptz AT TIME ZONE 'UTC')
          AND created_at <  (${endIso}::timestamptz AT TIME ZONE 'UTC')
          AND status::text = ANY(${COUNTED as string[]})
      `,
      prisma.$queryRaw<{ day: string; orders: bigint; sales: bigint | null }[]>`
        SELECT to_char(created_at + make_interval(mins => ${STORE_OFFSET_MINUTES}), 'YYYY-MM-DD') AS day,
               COUNT(*) AS orders, SUM(total_minor) AS sales
        FROM orders
        WHERE created_at >= (${startIso}::timestamptz AT TIME ZONE 'UTC')
          AND created_at <  (${endIso}::timestamptz AT TIME ZONE 'UTC')
          AND status::text = ANY(${COUNTED as string[]})
        GROUP BY 1
      `,
      prisma.$queryRaw<
        { product_id: string | null; name: string; units: bigint; sales: bigint | null }[]
      >`
        SELECT oi.product_id, MAX(oi.product_name_snapshot) AS name,
               SUM(oi.quantity) AS units, SUM(oi.line_total_minor) AS sales
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        WHERE o.created_at >= (${startIso}::timestamptz AT TIME ZONE 'UTC')
          AND o.created_at <  (${endIso}::timestamptz AT TIME ZONE 'UTC')
          AND o.status::text = ANY(${COUNTED as string[]})
        GROUP BY oi.product_id, CASE WHEN oi.product_id IS NULL THEN oi.product_name_snapshot END
        ORDER BY units DESC, sales DESC
        LIMIT 5
      `,
      prisma.$queryRaw<{ refunds: bigint | null }[]>`
        SELECT SUM(amount_minor) AS refunds
        FROM refunds
        WHERE status = 'SUCCEEDED'
          AND created_at >= (${startIso}::timestamptz AT TIME ZONE 'UTC')
          AND created_at <  (${endIso}::timestamptz AT TIME ZONE 'UTC')
      `,
      prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*) AS count FROM product_variants
        WHERE status = 'ACTIVE' AND low_stock_threshold > 0 AND stock_quantity <= low_stock_threshold
      `,
      prisma.order.findMany({
        where: { createdAt: { gte: start, lt: end } },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, orderNumber: true, status: true, totalMinor: true, createdAt: true },
      }),
    ]);

  const byStatus: Partial<Record<OrderStatus, number>> = {};
  for (const row of statusRows) byStatus[row.status] = n(row.count);

  const ordersCounted = n(totalsRow[0]?.orders);
  const salesMinor = n(totalsRow[0]?.sales);
  const refundsMinor = n(refundRow[0]?.refunds);
  const perDay = new Map(dailyRows.map((row) => [row.day, row]));

  return {
    range: { from: range.from, to: range.to },
    currency: env.STORE_CURRENCY,
    ordersPlaced: statusRows.reduce((sum, row) => sum + n(row.count), 0),
    ordersCounted,
    salesMinor,
    refundsMinor,
    netMinor: salesMinor - refundsMinor,
    discountsMinor: n(totalsRow[0]?.discounts),
    averageOrderMinor: ordersCounted > 0 ? Math.round(salesMinor / ordersCounted) : null,
    byStatus,
    daily: listDays(range).map((date) => ({
      date,
      orders: n(perDay.get(date)?.orders),
      salesMinor: n(perDay.get(date)?.sales),
    })),
    topProducts: productRows.map((row) => ({
      productId: row.product_id,
      name: row.name,
      units: n(row.units),
      salesMinor: n(row.sales),
    })),
    lowStockVariants: n(lowStock[0]?.count),
    recentOrders: recent,
  };
}
