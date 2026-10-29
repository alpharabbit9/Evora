-- CreateEnum
CREATE TYPE "CartStatus" AS ENUM ('ACTIVE', 'CONVERTED', 'ABANDONED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FIXED');

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "guest_token_hash" TEXT,
    "status" "CartStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cart_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "percent_bps" INTEGER,
    "value_minor" INTEGER,
    "currency" CHAR(3),
    "minimum_spend_minor" INTEGER,
    "max_discount_minor" INTEGER,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "usage_limit" INTEGER,
    "per_user_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "applies_to_all_products" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_products" (
    "coupon_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,

    CONSTRAINT "coupon_products_pkey" PRIMARY KEY ("coupon_id","product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carts_guest_token_hash_key" ON "carts"("guest_token_hash");

-- CreateIndex
CREATE INDEX "carts_user_id_idx" ON "carts"("user_id");

-- CreateIndex
CREATE INDEX "carts_status_expires_at_idx" ON "carts"("status", "expires_at");

-- CreateIndex
CREATE INDEX "cart_items_variant_id_idx" ON "cart_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_code_key" ON "coupons"("code");

-- CreateIndex
CREATE INDEX "coupons_is_active_ends_at_idx" ON "coupons"("is_active", "ends_at");

-- CreateIndex
CREATE INDEX "coupon_products_product_id_idx" ON "coupon_products"("product_id");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_products" ADD CONSTRAINT "coupon_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- HAND-WRITTEN CONSTRAINTS — see the review rule in 20261021120000_identity.
-- ===========================================================================

-- --- Cart ------------------------------------------------------------------
-- A cart has exactly one owner: a signed-in user, or an opaque guest token. "Both" would
-- make ownership checks ambiguous; "neither" would make the cart unreachable.
ALTER TABLE "carts" ADD CONSTRAINT "carts_single_owner_check" CHECK (("user_id" IS NOT NULL) <> ("guest_token_hash" IS NOT NULL));

-- One ACTIVE cart per owner, so "the current cart" is never an arbitrary pick of two rows.
-- Partial unique indexes have no Prisma equivalent.
CREATE UNIQUE INDEX "carts_one_active_per_user_key" ON "carts"("user_id") WHERE "status" = 'ACTIVE' AND "user_id" IS NOT NULL;
CREATE UNIQUE INDEX "carts_one_active_per_guest_key" ON "carts"("guest_token_hash") WHERE "status" = 'ACTIVE' AND "guest_token_hash" IS NOT NULL;

-- --- CartItem --------------------------------------------------------------
-- The database only rejects nonsense; the real per-order cap is a service policy.
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_quantity_range_check" CHECK ("quantity" >= 1 AND "quantity" <= 999);

-- --- Coupon ----------------------------------------------------------------
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_code_uppercase_check" CHECK ("code" = upper("code") AND char_length(btrim("code")) > 0);

-- A PERCENT coupon carries a rate and no amount; a FIXED coupon carries an amount and the
-- currency that amount is in. Neither can be half-configured.
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_matches_type_check" CHECK (
  ("type" = 'PERCENT' AND "percent_bps" IS NOT NULL AND "value_minor" IS NULL)
  OR ("type" = 'FIXED' AND "value_minor" IS NOT NULL AND "percent_bps" IS NULL AND "currency" IS NOT NULL)
);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_percent_bps_range_check" CHECK ("percent_bps" IS NULL OR ("percent_bps" >= 1 AND "percent_bps" <= 10000));
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_value_minor_check" CHECK ("value_minor" IS NULL OR "value_minor" >= 0);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_minimum_spend_check" CHECK ("minimum_spend_minor" IS NULL OR "minimum_spend_minor" >= 0);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_max_discount_check" CHECK ("max_discount_minor" IS NULL OR "max_discount_minor" >= 0);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_currency_format_check" CHECK ("currency" IS NULL OR ("currency" = upper("currency") AND char_length(btrim("currency")) = 3));
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_usage_limit_check" CHECK ("usage_limit" IS NULL OR "usage_limit" > 0);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_per_user_limit_check" CHECK ("per_user_limit" IS NULL OR "per_user_limit" > 0);
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_used_count_check" CHECK ("used_count" >= 0);

-- The conditional claim UPDATE in the pricing service is what makes concurrent redemption
-- safe; this is the backstop that makes over-redemption impossible even if that is wrong.
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_used_within_limit_check" CHECK ("usage_limit" IS NULL OR "used_count" <= "usage_limit");
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_validity_window_check" CHECK ("starts_at" IS NULL OR "ends_at" IS NULL OR "ends_at" > "starts_at");
