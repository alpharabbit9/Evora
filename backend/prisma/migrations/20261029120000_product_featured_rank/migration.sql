-- Featured ordering for the storefront (ADR 0013). Purely additive: one nullable column, one
-- CHECK, one index. No existing column, constraint or row is altered.

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "featured_rank" INTEGER;

-- CreateIndex
CREATE INDEX "products_featured_rank_idx" ON "products"("featured_rank");

-- --- Hand-written ----------------------------------------------------------
-- A rank is a 1-based position; zero or negative would sort ahead of "1" and means nothing.
ALTER TABLE "products" ADD CONSTRAINT "products_featured_rank_positive_check" CHECK (
  "featured_rank" IS NULL OR "featured_rank" > 0
);
