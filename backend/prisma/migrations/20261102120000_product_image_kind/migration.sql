-- Garment cut-outs for the home page's arrivals rail (ADR 0017). Purely additive: one enum, one
-- column defaulting every existing row to PHOTO, one partial unique index.

-- CreateEnum
CREATE TYPE "ProductImageKind" AS ENUM ('PHOTO', 'CUTOUT');

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "kind" "ProductImageKind" NOT NULL DEFAULT 'PHOTO';

-- --- Hand-written ----------------------------------------------------------
-- The rail shows one cut-out per product; a second would make "which one" arbitrary.
CREATE UNIQUE INDEX "product_images_one_cutout_per_product_key" ON "product_images"("product_id") WHERE "kind" = 'CUTOUT';
