-- The unit price a customer was last shown for a bag line, so the bag can say when it has
-- changed since (PRD FR-02, implementation-plan.md M5). Display only: checkout never reads it,
-- it prices from the catalog. Nullable: lines added before this column have no remembered price
-- and simply show no notice.
ALTER TABLE "cart_items" ADD COLUMN "unit_price_seen_minor" INTEGER;

ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_unit_price_seen_non_negative_check" CHECK ("unit_price_seen_minor" IS NULL OR "unit_price_seen_minor" >= 0);
