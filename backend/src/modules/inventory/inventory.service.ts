import { type Prisma } from '@prisma/client';

import { notFound, outOfStock, validationFailed } from '../../http/errors.js';
import { type Pagination, toSkipTake } from '../../http/schemas.js';
import { prisma } from '../../lib/prisma.js';
import { withTransaction, type TransactionClient } from '../../lib/transaction.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';
import type { AdminActionContext } from '../admin/customers.service.js';
import type { AdminStockAdjustmentBody } from './inventory.schemas.js';

// ---------------------------------------------------------------------------
// Admin stock adjustment (ADR 0004: atomic decrement-on-order)
// ---------------------------------------------------------------------------

/**
 * Adjust a variant's stock and record the movement atomically.
 * This is the admin path — checkout has its own `claimStock` below.
 */
export async function adminAdjustStock(
  body: AdminStockAdjustmentBody,
  context: AdminActionContext,
) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: body.variantId },
    select: { id: true, sku: true, stockQuantity: true, lowStockThreshold: true },
  });

  if (!variant) {
    throw notFound('That variant does not exist.');
  }

  const result = await withTransaction(
    async (tx) => {
      // Conditional atomic write: for negative deltas, ensure stock won't go below 0.
      // For positive deltas, always succeeds.
      let rows: { id: string; stock_quantity: number; low_stock_threshold: number; sku: string }[];

      if (body.delta < 0) {
        rows = await tx.$queryRawUnsafe<typeof rows>(
          `UPDATE product_variants
           SET stock_quantity = stock_quantity + $1, updated_at = NOW()
           WHERE id = $2 AND stock_quantity >= $3
           RETURNING id, stock_quantity, low_stock_threshold, sku`,
          body.delta,
          body.variantId,
          -body.delta,
        );
      } else {
        rows = await tx.$queryRawUnsafe<typeof rows>(
          `UPDATE product_variants
           SET stock_quantity = stock_quantity + $1, updated_at = NOW()
           WHERE id = $2
           RETURNING id, stock_quantity, low_stock_threshold, sku`,
          body.delta,
          body.variantId,
        );
      }

      const updated = rows[0];
      if (!updated) {
        throw validationFailed([
          {
            field: 'delta',
            issue: `Adjustment would result in negative stock (current: ${String(variant.stockQuantity)}, delta: ${String(body.delta)}).`,
          },
        ]);
      }

      await tx.inventoryMovement.create({
        data: {
          variantId: body.variantId,
          delta: body.delta,
          resultingQuantity: updated.stock_quantity,
          reason: body.reason,
          actorUserId: context.actor.id,
          note: body.note ?? null,
        },
      });

      await recordAudit(tx, {
        action: AuditAction.STOCK_ADJUSTED,
        entityType: 'ProductVariant',
        entityId: body.variantId,
        actor: context.actor,
        before: { stockQuantity: variant.stockQuantity },
        after: {
          stockQuantity: updated.stock_quantity,
          delta: body.delta,
          reason: body.reason,
          ...(body.note ? { note: body.note } : {}),
        },
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
        ...(context.requestId ? { requestId: context.requestId } : {}),
      });

      return {
        id: updated.id,
        sku: updated.sku,
        stockQuantity: updated.stock_quantity,
        lowStockThreshold: updated.low_stock_threshold,
      };
    },
    { label: 'inventory.adminAdjustStock' },
  );

  if (result.lowStockThreshold > 0 && result.stockQuantity <= result.lowStockThreshold) {
    await insertLowStockAlert(
      result.id,
      result.sku,
      result.stockQuantity,
      result.lowStockThreshold,
    );
  }

  return result;
}

// ---------------------------------------------------------------------------
// Concurrency-safe stock claim (for checkout — ADR 0004, architecture.md §8)
// ---------------------------------------------------------------------------

export interface StockClaimItem {
  readonly variantId: string;
  readonly quantity: number;
}

/**
 * Atomically claim stock for one or more variants inside an existing transaction.
 * Variants are processed in sorted id order to avoid deadlocks.
 * Returns the resulting movements; throws `OUT_OF_STOCK` on the first variant that
 * cannot be claimed, rolling back the entire transaction.
 */
export async function claimStock(
  tx: TransactionClient,
  items: readonly StockClaimItem[],
  orderId: string,
) {
  const sorted = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId));
  const movements = [];

  for (const item of sorted) {
    // Conditional atomic write (architecture.md §8)
    const rows = await tx.$queryRawUnsafe<{ id: string; stock_quantity: number }[]>(
      `UPDATE product_variants
       SET stock_quantity = stock_quantity - $1, updated_at = NOW()
       WHERE id = $2 AND stock_quantity >= $1
       RETURNING id, stock_quantity`,
      item.quantity,
      item.variantId,
    );

    const row = rows[0];
    if (!row) {
      throw outOfStock('An item in your order just sold out or has too little stock left.', {
        details: [{ field: `items.${item.variantId}`, issue: 'Not enough stock' }],
      });
    }

    const resultingQuantity = row.stock_quantity;

    const movement = await tx.inventoryMovement.create({
      data: {
        variantId: item.variantId,
        delta: -item.quantity,
        resultingQuantity,
        reason: 'ORDER_PLACED',
        orderId,
      },
    });

    movements.push(movement);
  }

  return movements;
}

/**
 * Release previously claimed stock (payment failure / cancellation).
 *
 * Idempotent by the ledger's balance rather than by "has a release ever been written": what this
 * order still holds is the negative of its movements for the variant. So a repeat releases nothing,
 * and an order that was released and then re-claimed (a payment that arrived late, ADR 0019) can
 * still be released later. Checking for an earlier release would have leaked that stock for good.
 */
export async function releaseStock(
  tx: TransactionClient,
  items: readonly StockClaimItem[],
  orderId: string,
  reason: 'ORDER_CANCELLED' | 'REFUND_RESTOCK',
) {
  const sorted = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId));

  for (const item of sorted) {
    const ledger = await tx.inventoryMovement.aggregate({
      where: { orderId, variantId: item.variantId },
      _sum: { delta: true },
    });
    const held = -(ledger._sum.delta ?? 0);
    const quantity = Math.min(item.quantity, held);

    if (quantity <= 0) continue;

    const rows = await tx.$queryRawUnsafe<{ id: string; stock_quantity: number }[]>(
      `UPDATE product_variants
       SET stock_quantity = stock_quantity + $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, stock_quantity`,
      quantity,
      item.variantId,
    );

    const row = rows[0];
    if (!row) continue;

    await tx.inventoryMovement.create({
      data: {
        variantId: item.variantId,
        delta: quantity,
        resultingQuantity: row.stock_quantity,
        reason,
        orderId,
      },
    });
  }
}

/**
 * Claim stock for an order whose stock was already released, when not having it is an answer
 * rather than an error (a payment that arrived after its order closed, ADR 0019).
 *
 * `claimStock` signals a shortage by throwing, after possibly claiming earlier lines, which only
 * works when the throw rolls the transaction back. Here the transaction must commit either way, to
 * record the money. So the rows are locked first, in the same stable order, and checked: once they
 * pass, no concurrent sale can make the claim fail.
 */
export async function tryReclaimStock(
  tx: TransactionClient,
  items: readonly StockClaimItem[],
  orderId: string,
): Promise<boolean> {
  const sorted = [...items].sort((a, b) => a.variantId.localeCompare(b.variantId));

  for (const item of sorted) {
    const rows = await tx.$queryRawUnsafe<{ stock_quantity: number }[]>(
      `SELECT stock_quantity FROM product_variants WHERE id = $1 FOR UPDATE`,
      item.variantId,
    );
    const row = rows[0];

    if (!row || row.stock_quantity < item.quantity) {
      return false;
    }
  }

  await claimStock(tx, sorted, orderId);

  return true;
}

// ---------------------------------------------------------------------------
// Admin inventory listing
// ---------------------------------------------------------------------------

export interface InventoryFilters {
  readonly q?: string;
  readonly lowStockOnly?: boolean;
  readonly categoryId?: string;
}

export async function adminListInventory(pagination: Pagination, filters: InventoryFilters) {
  const { skip, take } = toSkipTake(pagination);

  const where: Prisma.ProductVariantWhereInput = {
    product: {
      status: { not: 'ARCHIVED' },
      ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    },
    ...(filters.q
      ? {
          OR: [
            { sku: { contains: filters.q, mode: 'insensitive' } },
            { product: { name: { contains: filters.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  if (filters.lowStockOnly) {
    return adminListInventoryLowStock(pagination, filters);
  }

  const [rows, total] = await Promise.all([
    prisma.productVariant.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      skip,
      take,
      select: INVENTORY_SELECT,
    }),
    prisma.productVariant.count({ where }),
  ]);

  return {
    items: rows.map(toInventoryView),
    total,
  };
}

async function adminListInventoryLowStock(pagination: Pagination, filters: InventoryFilters) {
  const { skip, take } = toSkipTake(pagination);

  const categoryCondition = filters.categoryId ? `AND p.category_id = $3` : '';
  const searchCondition = filters.q
    ? `AND (pv.sku ILIKE $${filters.categoryId ? '4' : '3'} OR p.name ILIKE $${filters.categoryId ? '4' : '3'})`
    : '';

  const params: (string | number)[] = [take, skip];
  if (filters.categoryId) params.push(filters.categoryId);
  if (filters.q) params.push(`%${filters.q}%`);

  const countParams: (string | number)[] = [];
  if (filters.categoryId) countParams.push(filters.categoryId);
  if (filters.q) countParams.push(`%${filters.q}%`);

  const countCategoryCondition = filters.categoryId ? `AND p.category_id = $1` : '';
  const countSearchCondition = filters.q
    ? `AND (pv.sku ILIKE $${filters.categoryId ? '2' : '1'} OR p.name ILIKE $${filters.categoryId ? '2' : '1'})`
    : '';

  const rows = await prisma.$queryRawUnsafe<InventoryRawRow[]>(
    `SELECT pv.id, pv.sku, pv.option_key, pv.options, pv.price_minor, pv.stock_quantity,
            pv.low_stock_threshold, pv.status, pv.updated_at,
            p.id AS product_id, p.name AS product_name, p.slug AS product_slug
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE p.status <> 'ARCHIVED'
       AND pv.low_stock_threshold > 0
       AND pv.stock_quantity <= pv.low_stock_threshold
       ${categoryCondition}
       ${searchCondition}
     ORDER BY pv.stock_quantity ASC, pv.updated_at DESC
     LIMIT $1 OFFSET $2`,
    ...params,
  );

  const countRows = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
    `SELECT COUNT(*) AS count
     FROM product_variants pv
     JOIN products p ON p.id = pv.product_id
     WHERE p.status <> 'ARCHIVED'
       AND pv.low_stock_threshold > 0
       AND pv.stock_quantity <= pv.low_stock_threshold
       ${countCategoryCondition}
       ${countSearchCondition}`,
    ...countParams,
  );

  return {
    items: rows.map(rawRowToView),
    total: Number(countRows[0]?.count ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Movement history
// ---------------------------------------------------------------------------

export interface MovementFilters {
  readonly variantId?: string;
  readonly reason?: string;
}

export async function adminListMovements(pagination: Pagination, filters: MovementFilters) {
  const { skip, take } = toSkipTake(pagination);

  const where: Prisma.InventoryMovementWhereInput = {
    ...(filters.variantId ? { variantId: filters.variantId } : {}),
    ...(filters.reason
      ? { reason: filters.reason as Prisma.EnumInventoryMovementReasonFilter }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.inventoryMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id: true,
        variantId: true,
        delta: true,
        resultingQuantity: true,
        reason: true,
        note: true,
        actorUserId: true,
        orderId: true,
        createdAt: true,
        variant: {
          select: { sku: true, product: { select: { id: true, name: true } } },
        },
        actor: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.inventoryMovement.count({ where }),
  ]);

  return { items: rows, total };
}

// ---------------------------------------------------------------------------
// Get variant stock detail
// ---------------------------------------------------------------------------

export async function adminGetVariantStock(variantId: string) {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    select: {
      ...INVENTORY_SELECT,
      inventoryMovements: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          delta: true,
          resultingQuantity: true,
          reason: true,
          note: true,
          actorUserId: true,
          orderId: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!variant) {
    throw notFound('That variant does not exist.');
  }

  return {
    ...toInventoryView(variant),
    recentMovements: variant.inventoryMovements,
  };
}

// ---------------------------------------------------------------------------
// Low-stock alert outbox event
// ---------------------------------------------------------------------------

export interface OrderStockChange {
  readonly variantId: string;
  readonly sku: string;
  readonly previousQuantity: number;
  readonly currentQuantity: number;
  readonly threshold: number;
}

/**
 * Low-stock alerts for an order's claims, committed with them. Only a claim that takes a variant
 * from above its threshold to at or below it raises one: every later sale of an already-low
 * variant would otherwise repeat the same alert.
 */
export async function queueLowStockAlerts(
  tx: TransactionClient,
  orderId: string,
  changes: readonly OrderStockChange[],
): Promise<void> {
  for (const change of changes) {
    const crossed =
      change.threshold > 0 &&
      change.previousQuantity > change.threshold &&
      change.currentQuantity <= change.threshold;

    if (!crossed) continue;

    await tx.outboxEvent.create({
      data: {
        eventType: 'LOW_STOCK_ALERT',
        dedupeKey: `low-stock:${change.variantId}:order:${orderId}`,
        payload: {
          variantId: change.variantId,
          sku: change.sku,
          currentStock: change.currentQuantity,
          threshold: change.threshold,
        },
      },
    });
  }
}

async function insertLowStockAlert(
  variantId: string,
  sku: string,
  currentStock: number,
  threshold: number,
) {
  const dedupeKey = `low-stock:${variantId}:${String(currentStock)}:${Date.now()}`;
  await prisma.outboxEvent.create({
    data: {
      eventType: 'LOW_STOCK_ALERT',
      dedupeKey,
      payload: { variantId, sku, currentStock, threshold },
    },
  });
}

// ---------------------------------------------------------------------------
// Internal shapes
// ---------------------------------------------------------------------------

const INVENTORY_SELECT = {
  id: true,
  sku: true,
  optionKey: true,
  options: true,
  priceMinor: true,
  stockQuantity: true,
  lowStockThreshold: true,
  status: true,
  updatedAt: true,
  product: { select: { id: true, name: true, slug: true } },
} satisfies Prisma.ProductVariantSelect;

type InventoryRow = Prisma.ProductVariantGetPayload<{ select: typeof INVENTORY_SELECT }>;

function toInventoryView(row: InventoryRow) {
  return {
    id: row.id,
    sku: row.sku,
    optionKey: row.optionKey,
    options: row.options,
    priceMinor: row.priceMinor,
    stockQuantity: row.stockQuantity,
    lowStockThreshold: row.lowStockThreshold,
    isLowStock: row.lowStockThreshold > 0 && row.stockQuantity <= row.lowStockThreshold,
    status: row.status,
    updatedAt: row.updatedAt,
    product: row.product,
  };
}

interface InventoryRawRow {
  id: string;
  sku: string;
  option_key: string;
  options: unknown;
  price_minor: number;
  stock_quantity: number;
  low_stock_threshold: number;
  status: string;
  updated_at: Date;
  product_id: string;
  product_name: string;
  product_slug: string;
}

function rawRowToView(row: InventoryRawRow) {
  return {
    id: row.id,
    sku: row.sku,
    optionKey: row.option_key,
    options: row.options,
    priceMinor: row.price_minor,
    stockQuantity: row.stock_quantity,
    lowStockThreshold: row.low_stock_threshold,
    isLowStock: true,
    status: row.status,
    updatedAt: row.updated_at,
    product: { id: row.product_id, name: row.product_name, slug: row.product_slug },
  };
}
