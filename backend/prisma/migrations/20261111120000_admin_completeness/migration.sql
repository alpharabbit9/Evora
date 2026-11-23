-- M10 (ADR 0022): coupons at checkout, store settings, and indexes for the admin overview and the
-- audit log. Additive: no existing row or constraint is touched.

-- A redemption whose order closed (cancelled, or the payment failed) gives its use back. The row is
-- kept for history; `released_at` says it no longer counts towards the coupon's limits.
ALTER TABLE "coupon_redemptions" ADD COLUMN "released_at" TIMESTAMP(3);

-- One row, `id = 'default'`. Until an administrator saves it, the application uses the defaults in
-- `src/modules/settings/settings.service.ts`, which are ADR 0018's provisional delivery fees.
CREATE TABLE "store_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "store_name" TEXT NOT NULL,
    "support_email" TEXT,
    "standard_fee_dhaka_minor" INTEGER NOT NULL,
    "standard_fee_national_minor" INTEGER NOT NULL,
    "express_enabled" BOOLEAN NOT NULL DEFAULT true,
    "express_fee_dhaka_minor" INTEGER NOT NULL,
    "express_fee_national_minor" INTEGER NOT NULL,
    "free_shipping_threshold_minor" INTEGER,
    "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The admin overview reads orders by date range across every status.
CREATE INDEX "orders_created_at_idx" ON "orders"("created_at");

-- The audit log's unfiltered view is newest first.
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- Per-customer limits count a customer's live redemptions of one coupon.
CREATE INDEX "coupon_redemptions_coupon_id_user_id_released_at_idx" ON "coupon_redemptions"("coupon_id", "user_id", "released_at");

-- ===========================================================================
-- HAND-WRITTEN CONSTRAINTS — see the review rule in 20261021120000_identity.
-- ===========================================================================

ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_singleton_check" CHECK ("id" = 'default');
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_store_name_check"
  CHECK (char_length(btrim("store_name")) BETWEEN 1 AND 80);
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_fees_check" CHECK (
  "standard_fee_dhaka_minor" >= 0 AND "standard_fee_national_minor" >= 0
  AND "express_fee_dhaka_minor" >= 0 AND "express_fee_national_minor" >= 0
  AND ("free_shipping_threshold_minor" IS NULL OR "free_shipping_threshold_minor" > 0)
);
-- Exclusive tax only: `orders_total_identity_check` adds tax to the total. Capped well below 100 %.
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_tax_rate_check"
  CHECK ("tax_rate_bps" BETWEEN 0 AND 5000);
ALTER TABLE "store_settings" ADD CONSTRAINT "store_settings_version_check" CHECK ("version" >= 1);
