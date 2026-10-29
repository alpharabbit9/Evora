-- M3 — catalog import provenance, product gender, price provenance (ADR 0011).
--
-- Generated with `prisma migrate diff --from-config-datasource --to-schema` and reviewed; the
-- CHECK at the bottom is hand-written. Purely additive: two new enums, nullable columns, one
-- NOT NULL column with a default (existing variants become MANUAL), one index, one unique
-- index. No existing column, constraint or row is altered or dropped.

-- CreateEnum
CREATE TYPE "ProductGender" AS ENUM ('MEN', 'WOMEN', 'UNISEX');

-- CreateEnum
CREATE TYPE "PriceSource" AS ENUM ('MANUAL', 'SOURCE', 'SYNTHETIC');

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "attribution" TEXT,
ADD COLUMN     "source_url" TEXT;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "price_source" "PriceSource" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "gender" "ProductGender",
ADD COLUMN     "source_content_hash" TEXT,
ADD COLUMN     "source_external_id" TEXT,
ADD COLUMN     "source_provider" TEXT,
ADD COLUMN     "source_url" TEXT;

-- CreateIndex
CREATE INDEX "products_gender_status_idx" ON "products"("gender", "status");

-- CreateIndex
-- Postgres treats NULLs as distinct, so any number of hand-made products (both NULL) coexist;
-- only imported rows are constrained to one per (provider, external id).
CREATE UNIQUE INDEX "products_source_provider_source_external_id_key" ON "products"("source_provider", "source_external_id");

-- --- Hand-written ----------------------------------------------------------
-- A half-set key would escape the unique index above (NULL never collides) and let a rerun
-- create a duplicate, so the pair is all-or-nothing and never blank.
ALTER TABLE "products" ADD CONSTRAINT "products_source_identity_check" CHECK (
  ("source_provider" IS NULL AND "source_external_id" IS NULL)
  OR (char_length(btrim("source_provider")) > 0 AND char_length(btrim("source_external_id")) > 0)
);
