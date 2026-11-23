-- M8 (ADR 0020): shipment tracking on the order, and notifications for cancellations and refunds.
-- Additive: no existing row or constraint is touched.
ALTER TABLE "orders" ADD COLUMN "shipping_carrier" TEXT;
ALTER TABLE "orders" ADD COLUMN "tracking_number" TEXT;

ALTER TABLE "orders" ADD CONSTRAINT "orders_tracking_length_check"
  CHECK (
    ("shipping_carrier" IS NULL OR char_length(btrim("shipping_carrier")) BETWEEN 1 AND 80)
    AND ("tracking_number" IS NULL OR char_length(btrim("tracking_number")) BETWEEN 1 AND 120)
  );

ALTER TYPE "OutboxEventType" ADD VALUE 'ORDER_CANCELLED';
ALTER TYPE "OutboxEventType" ADD VALUE 'REFUND_UPDATE';
