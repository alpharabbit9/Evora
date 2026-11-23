# ADR 0004 — Inventory Consistency Policy
- **Status:** Accepted
- **Date:** 2026-10-21; accepted 2026-11-03
- **Context:** Concurrent checkout must not purchase the same final unit; online payment can remain pending.

## Decision

**Atomic decrement-on-order.** Stock is claimed in the same transaction that creates the
order and its inventory movements. No timed reservation model for v1.

### How it works

1. Inside a short `withTransaction` (architecture.md §6), each variant's `stock_quantity`
   is decremented with a conditional atomic write:

   ```sql
   UPDATE product_variants
   SET stock_quantity = stock_quantity - $qty, updated_at = NOW()
   WHERE id = $variantId AND stock_quantity >= $qty
   RETURNING id, stock_quantity;
   ```

   No returned row → `OUT_OF_STOCK` and the transaction rolls back.

2. An `InventoryMovement` row is written in the **same transaction** for every balance
   change, recording `delta`, `resultingQuantity`, `reason`, `actorUserId`/`orderId`,
   and an optional `note`. The movement table is append-only and auditable.

3. For multi-item orders, variants are locked in a **stable order** (sorted by `id`) to
   avoid deadlocks. Write-conflict retries (`P2034`) are handled by `withTransaction`.

4. Admin stock adjustments also write a movement and the balance update atomically.
   Reason is one of `ADMIN_ADJUSTMENT`, `DAMAGE`, `RETURN`, `IMPORT_CORRECTION`.

### Compensation

Payment failure or order cancellation **restores** stock with a positive movement
(`ORDER_CANCELLED` / `REFUND_RESTOCK` reason) in its own short transaction. This is
idempotent: movements are tied to an order id, and what is released is what the ledger
says the order still holds, so a repeat releases nothing. (Originally this checked whether
a release had ever been written; ADR 0019 changed it, because an order re-claimed after a
late payment must remain releasable.)

### Low-stock alerts

When a stock change brings `stockQuantity` at or below `lowStockThreshold` (and the
threshold is > 0), the service inserts a `LOW_STOCK_ALERT` outbox event. The outbox
worker (M9) will deliver it; until then the event sits in the table.

### Why not timed reservations (yet)

Timed reservations require an expiry worker, release/consume transitions, and
reconciliation for late payment after expiry. These add complexity that is not justified
until the online payment provider (M7) is integrated and real hold-vs-release behavior
is needed. The schema already has `InventoryReservation` deferred in the Prisma schema,
so the path is open.

## Consequences
- Simpler to implement and reason about than reservations.
- A failed/abandoned payment after order creation needs compensation to release stock.
- No "hold" period: stock is committed at order creation, not at payment completion.
- Future: adding reservations requires splitting `stockQuantity` into on-hand vs
  available, which is a migration with a data backfill.
