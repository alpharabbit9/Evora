-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'PAYMENT_FAILED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'FAILED', 'COD_PENDING', 'COD_COLLECTED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('COD', 'ONLINE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'PARTIALLY_REFUNDED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookProcessingStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED_DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "InventoryMovementReason" AS ENUM ('ORDER_PLACED', 'ORDER_CANCELLED', 'REFUND_RESTOCK', 'ADMIN_ADJUSTMENT', 'IMPORT_CORRECTION', 'DAMAGE', 'RETURN');

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "order_number" TEXT NOT NULL,
    "user_id" TEXT,
    "guest_access_token_hash" TEXT,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "payment_method" "PaymentMethod" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal_minor" INTEGER NOT NULL,
    "discount_minor" INTEGER NOT NULL DEFAULT 0,
    "shipping_minor" INTEGER NOT NULL DEFAULT 0,
    "tax_minor" INTEGER NOT NULL DEFAULT 0,
    "total_minor" INTEGER NOT NULL,
    "coupon_id" TEXT,
    "coupon_code_snapshot" TEXT,
    "contact_email" TEXT NOT NULL,
    "contact_phone" TEXT,
    "ship_recipient_name" TEXT NOT NULL,
    "ship_line1" TEXT NOT NULL,
    "ship_line2" TEXT,
    "ship_city" TEXT NOT NULL,
    "ship_state" TEXT,
    "ship_postal_code" TEXT NOT NULL,
    "ship_country_code" CHAR(2) NOT NULL,
    "shipping_method" TEXT,
    "idempotency_key" TEXT,
    "request_fingerprint" TEXT,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "product_id" TEXT,
    "variant_id" TEXT,
    "product_name_snapshot" TEXT NOT NULL,
    "sku_snapshot" TEXT NOT NULL,
    "variant_options_snapshot" JSONB,
    "unit_price_minor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "line_discount_minor" INTEGER NOT NULL DEFAULT 0,
    "line_tax_minor" INTEGER NOT NULL DEFAULT 0,
    "line_total_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_status_history" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "actor_user_id" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "user_id" TEXT,
    "discount_minor" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_payment_ref" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "idempotency_key" TEXT,
    "failure_code" TEXT,
    "safe_metadata" JSONB,
    "authorized_at" TIMESTAMP(3),
    "captured_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "amount_minor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING',
    "provider_refund_ref" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "requested_by_user_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" "WebhookProcessingStatus" NOT NULL DEFAULT 'RECEIVED',
    "payload_hash" TEXT NOT NULL,
    "safe_metadata" JSONB,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "resulting_quantity" INTEGER NOT NULL,
    "reason" "InventoryMovementReason" NOT NULL,
    "actor_user_id" TEXT,
    "order_id" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE UNIQUE INDEX "orders_guest_access_token_hash_key" ON "orders"("guest_access_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "orders_idempotency_key_key" ON "orders"("idempotency_key");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "orders_payment_status_idx" ON "orders"("payment_status");

-- CreateIndex
CREATE INDEX "orders_coupon_id_idx" ON "orders"("coupon_id");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- CreateIndex
CREATE INDEX "order_items_variant_id_idx" ON "order_items"("variant_id");

-- CreateIndex
CREATE INDEX "order_status_history_order_id_created_at_idx" ON "order_status_history"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "order_status_history_actor_user_id_idx" ON "order_status_history"("actor_user_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_coupon_id_user_id_idx" ON "coupon_redemptions"("coupon_id", "user_id");

-- CreateIndex
CREATE INDEX "coupon_redemptions_order_id_idx" ON "coupon_redemptions"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_coupon_id_order_id_key" ON "coupon_redemptions"("coupon_id", "order_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_provider_payment_ref_key" ON "payments"("provider", "provider_payment_ref");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_idempotency_key_key" ON "payments"("provider", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_idempotency_key_key" ON "refunds"("idempotency_key");

-- CreateIndex
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- CreateIndex
CREATE INDEX "refunds_order_id_idx" ON "refunds"("order_id");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_payment_id_provider_refund_ref_key" ON "refunds"("payment_id", "provider_refund_ref");

-- CreateIndex
CREATE INDEX "webhook_events_status_received_at_idx" ON "webhook_events"("status", "received_at");

-- CreateIndex
CREATE INDEX "webhook_events_event_type_idx" ON "webhook_events"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_event_id_key" ON "webhook_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "inventory_movements_variant_id_created_at_idx" ON "inventory_movements"("variant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_movements_order_id_idx" ON "inventory_movements"("order_id");

-- CreateIndex
CREATE INDEX "inventory_movements_reason_idx" ON "inventory_movements"("reason");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- HAND-WRITTEN CONSTRAINTS — see the review rule in 20261021120000_identity.
-- ===========================================================================

-- --- Order -----------------------------------------------------------------
-- The server computes totals from trusted data (PRD §6 rule 1). These make an inconsistent
-- total unstorable, so a pricing bug fails loudly at the database instead of quietly
-- charging the wrong amount.
ALTER TABLE "orders" ADD CONSTRAINT "orders_money_non_negative_check" CHECK ("subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "shipping_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0);
ALTER TABLE "orders" ADD CONSTRAINT "orders_total_identity_check" CHECK ("total_minor" = "subtotal_minor" - "discount_minor" + "shipping_minor" + "tax_minor");
ALTER TABLE "orders" ADD CONSTRAINT "orders_discount_within_subtotal_check" CHECK ("discount_minor" <= "subtotal_minor");
ALTER TABLE "orders" ADD CONSTRAINT "orders_currency_format_check" CHECK ("currency" = upper("currency") AND char_length(btrim("currency")) = 3);
ALTER TABLE "orders" ADD CONSTRAINT "orders_ship_country_code_check" CHECK ("ship_country_code" = upper("ship_country_code") AND char_length(btrim("ship_country_code")) = 2);
ALTER TABLE "orders" ADD CONSTRAINT "orders_contact_email_check" CHECK ("contact_email" = lower("contact_email") AND char_length(btrim("contact_email")) > 0);

-- A guest order must be reachable by its unguessable access token: API_SPEC.md §6 forbids
-- relying on the public order number, which is why no order may have neither owner.
ALTER TABLE "orders" ADD CONSTRAINT "orders_reachable_owner_check" CHECK ("user_id" IS NOT NULL OR "guest_access_token_hash" IS NOT NULL);
ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_snapshot_check" CHECK ("coupon_id" IS NULL OR "coupon_code_snapshot" IS NOT NULL);

-- An idempotency key without its request fingerprint cannot answer "same key, different
-- payload" with 409 IDEMPOTENCY_CONFLICT, so the pair is all-or-nothing.
ALTER TABLE "orders" ADD CONSTRAINT "orders_idempotency_pair_check" CHECK (("idempotency_key" IS NULL) = ("request_fingerprint" IS NULL));

-- --- OrderItem -------------------------------------------------------------
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_quantity_check" CHECK ("quantity" > 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_money_non_negative_check" CHECK ("unit_price_minor" >= 0 AND "line_discount_minor" >= 0 AND "line_tax_minor" >= 0 AND "line_total_minor" >= 0);
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_line_total_identity_check" CHECK ("line_total_minor" = "unit_price_minor" * "quantity" - "line_discount_minor" + "line_tax_minor");
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_line_discount_bound_check" CHECK ("line_discount_minor" <= "unit_price_minor" * "quantity");
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_snapshot_not_blank_check" CHECK (char_length(btrim("product_name_snapshot")) > 0 AND char_length(btrim("sku_snapshot")) > 0);

-- --- OrderStatusHistory ----------------------------------------------------
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_transition_check" CHECK ("from_status" IS NULL OR "from_status" <> "to_status");
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_actor_check" CHECK ("actor_user_id" IS NOT NULL OR "is_system");

-- --- CouponRedemption ------------------------------------------------------
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_discount_check" CHECK ("discount_minor" > 0);

-- --- Payment ---------------------------------------------------------------
-- amount_minor may be 0: a 100%-discounted order still needs a payment record.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_check" CHECK ("amount_minor" >= 0);
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_format_check" CHECK ("currency" = upper("currency") AND char_length(btrim("currency")) = 3);
ALTER TABLE "payments" ADD CONSTRAINT "payments_provider_not_blank_check" CHECK (char_length(btrim("provider")) > 0);

-- Money cannot be recorded as captured while the attempt is pending or failed.
ALTER TABLE "payments" ADD CONSTRAINT "payments_captured_requires_success_check" CHECK ("captured_at" IS NULL OR "status" IN ('SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED'));

-- --- Refund ----------------------------------------------------------------
-- The unique idempotency_key (schema.prisma) plus a positive amount is what stands between
-- a retried refund request and a duplicate provider refund.
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_amount_check" CHECK ("amount_minor" > 0);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_currency_format_check" CHECK ("currency" = upper("currency") AND char_length(btrim("currency")) = 3);
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_idempotency_key_not_blank_check" CHECK (char_length(btrim("idempotency_key")) > 0);

-- --- WebhookEvent ----------------------------------------------------------
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_attempt_count_check" CHECK ("attempt_count" >= 0);
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_processed_timestamp_check" CHECK ("status" <> 'PROCESSED' OR "processed_at" IS NOT NULL);
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_identity_not_blank_check" CHECK (char_length(btrim("provider")) > 0 AND char_length(btrim("event_id")) > 0);

-- --- InventoryMovement -----------------------------------------------------
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_delta_check" CHECK ("delta" <> 0);
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_resulting_quantity_check" CHECK ("resulting_quantity" >= 0);

-- PRD FR-05 requires a reason AND an actor for a manual stock adjustment; system reasons
-- (an order, a refund, an import) legitimately have no user.
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_actor_check" CHECK ("actor_user_id" IS NOT NULL OR "reason" <> 'ADMIN_ADJUSTMENT');
