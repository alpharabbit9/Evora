# ADR 0022 — Coupons, Store Settings and Admin Reporting

- **Status:** Accepted for development. The coupon rules in decision 2 and the tax model in decision 5
  are **provisional**: PRD §9 has not decided coupon policy, tax rules or shipping fees.
- **Date:** 2026-11-12
- **Related:** [ADR 0004](0004-inventory-policy.md), [ADR 0009](0009-identity-authorization-and-rate-limiting.md),
  [ADR 0018](0018-checkout-orders-and-provisional-delivery.md), [ADR 0019](0019-online-payments-sslcommerz.md),
  [ADR 0020](0020-order-management-cancellation-refunds.md), [ADR 0021](0021-outbox-worker-and-email-delivery.md)

## Context
M10 asks for coupons with usage limits, shipping/tax/store settings, analytics, an audit UI and
bounded CSV operations, with tests that sensitive actions are audited, coupon limits cannot be
exceeded concurrently, and analytics query cost is reviewed. The schema already had `Coupon`,
`CouponProduct` and `CouponRedemption` (with a `used_count` counter and a CHECK against the limit),
but nothing used them. Fees were constants in `pricing.ts` (ADR 0018) and tax was always 0.

## Decision
1. **Coupons are applied at checkout and counted inside the order's transaction.** The quote reports
   a code as `applied` or `refused` with a reason, like an unavailable line, and never errors on one.
   Placing an order prices the code without a lock, inserts the order, claims stock, then locks the
   coupon, evaluates it again, checks the per-customer limit, and counts the use with
   `UPDATE … WHERE usage_limit IS NULL OR used_count < usage_limit`. A refused code rolls the whole
   order back with `409 COUPON_INVALID`. The code is part of the idempotency fingerprint.
2. **Provisional coupon rules:** one code per order; it discounts merchandise only (never delivery or
   tax); minimum spend is compared with the whole subtotal; a percentage is of the eligible lines,
   rounded down, then capped by `maxDiscount`; a fixed amount never exceeds the eligible lines. The
   end time is exclusive. Code and kind cannot change after creation; everything else can, and never
   touches orders already placed (each keeps its discount and `couponCodeSnapshot`).
3. **A closed order gives its use back.** Cancelling (ADR 0020) or a failed payment (ADR 0019) sets
   `coupon_redemptions.released_at` and decrements `used_count`, so a failed bKash attempt does not
   burn a single-use code. If money then arrives late and the order is confirmed again, the use is
   reclaimed if the coupon still has one; if not, the order keeps the discount it was paid at.
4. **Locking.** Variants are always locked before the coupon (checkout claims stock first; closing an
   order releases stock first). The coupon is locked `FOR NO KEY UPDATE`: inserting a row that
   references it takes `FOR KEY SHARE`, which `FOR UPDATE` would conflict with, and the concurrent
   checkout test deadlocked until this was changed.
5. **Store settings are one row** (`store_settings`, `id = 'default'`): store name, support email,
   standard and express fees for Dhaka and elsewhere, whether express is offered, a free-delivery
   threshold (compared with the discounted subtotal), and an **exclusive** tax rate (0–50 %, applied to
   the discounted merchandise, not delivery, rounded half up). Inclusive tax is not supported:
   `orders_total_identity_check` adds tax to the total. Until the row exists the defaults apply (ADR
   0018's fees, no tax). Checkout reads the settings inside its transaction. Saves are conditional on a
   `version` the administrator loaded (409 otherwise) and audited with only the fields that changed.
   Emails read the store name and support address at send time.
6. **Overview** (`GET /admin/overview?from&to`): a sale is an order that is CONFIRMED or further along;
   sales are `total_minor` by the store day it was placed; refunds are SUCCEEDED refunds by the day
   recorded; net = sales − refunds. Days are Bangladesh time, a fixed UTC+06:00. The range is at most
   366 days. Every query starts from an index (`orders_created_at_idx`, new; `order_items_order_id_idx`;
   `refunds_status_idx`) and aggregates in PostgreSQL, so a request reads tens of rows whatever the
   volume. It never runs during checkout and takes no locks.
7. **Audit log** (`GET /admin/audit-logs`): read-only, filterable by action, record and actor, newest
   first (`audit_logs_created_at_idx`, new). IP addresses are returned to superadmins only.
8. **Order export** (`GET /admin/reports/orders.csv?from&to&status`): at most 366 days and 10,000 rows,
   refused (400) rather than truncated beyond that. Order number, dates, statuses, money, coupon,
   item count, email, city and country; no street address or phone. Every field is quoted, and one a
   spreadsheet would run as a formula is prefixed with `'`. `Cache-Control: no-store`. Every export
   is audited with its range and row count.
9. **Customer management:** the superadmin-only role change (ADR 0009) gets its screen.

## Consequences
- Coupon limits hold under concurrency, proven by `tests/integration/admin-completeness.test.ts`
  (8 customers racing for 3 uses; one customer racing themselves for a per-customer limit of 1).
- A settings change applies to the next quote. A customer already on the checkout page is shown the
  new total before they can pay it (`expectedTotalMinor`).
- Analytics numbers depend on the definitions above; a partially refunded order counts its full
  sale and its refund separately.
- Coupon guessing is bounded by the checkout limiter (30 requests a minute).
- `withTransaction` retries `P2034` but not a raw-query deadlock (`40P01`); with the lock order above
  none is expected, and one would surface as a 500.

## Alternatives
- **Serializable transactions for coupons:** retries under contention for what a row lock settles.
- **Settings as environment variables:** a deploy for every fee change, and no audit of who changed it.
- **Discount allocated per line** (`order_items.line_discount_minor`): needed for per-line refunds or
  returns, which do not exist yet; the order-level discount is enough until a returns policy does.

## Revisit when
PRD §9 decides coupon stacking, tax (especially inclusive VAT) or shipping zones; returns need per-line
discounts; the store operates outside UTC+06:00; or exports need more than 10,000 rows (stream them).
