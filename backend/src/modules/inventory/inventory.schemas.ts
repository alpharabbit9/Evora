import { InventoryMovementReason } from '@prisma/client';
import { z } from 'zod';

import { opaqueId, paginationQuery } from '../../http/schemas.js';

/**
 * Admin inventory request shapes (API_SPEC.md §8, ADR 0004). All bodies are strict:
 * an unknown field is a 400, not a silently ignored key.
 */

// ---------------------------------------------------------------------------
// Stock adjustment (admin)
// ---------------------------------------------------------------------------

const adminAdjustmentReasons = [
  'ADMIN_ADJUSTMENT',
  'DAMAGE',
  'RETURN',
  'IMPORT_CORRECTION',
] as const satisfies readonly InventoryMovementReason[];

export const adminStockAdjustmentBody = z.strictObject({
  variantId: opaqueId,
  delta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'Delta must not be zero'),
  reason: z.enum(adminAdjustmentReasons),
  note: z.string().trim().max(500).optional(),
});

export type AdminStockAdjustmentBody = z.output<typeof adminStockAdjustmentBody>;

// ---------------------------------------------------------------------------
// Inventory listing (admin)
// ---------------------------------------------------------------------------

export const adminInventoryListQuery = paginationQuery.extend({
  q: z.string().trim().min(1).max(120).optional(),
  lowStockOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  categoryId: opaqueId.optional(),
});

export type AdminInventoryListQuery = z.output<typeof adminInventoryListQuery>;

// ---------------------------------------------------------------------------
// Movement history (admin)
// ---------------------------------------------------------------------------

export const adminMovementListQuery = paginationQuery.extend({
  variantId: opaqueId.optional(),
  reason: z.enum(InventoryMovementReason).optional(),
});

export type AdminMovementListQuery = z.output<typeof adminMovementListQuery>;
