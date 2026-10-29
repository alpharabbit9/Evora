-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductVariantStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "addresses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT,
    "recipient_name" TEXT NOT NULL,
    "phone" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "postal_code" TEXT NOT NULL,
    "country_code" CHAR(2) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "parent_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "brand" TEXT,
    "category_id" TEXT NOT NULL,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "option_key" TEXT NOT NULL DEFAULT 'default',
    "options" JSONB NOT NULL DEFAULT '{}',
    "price_minor" INTEGER NOT NULL,
    "compare_at_price_minor" INTEGER,
    "stock_quantity" INTEGER NOT NULL DEFAULT 0,
    "low_stock_threshold" INTEGER NOT NULL DEFAULT 0,
    "weight_grams" INTEGER,
    "status" "ProductVariantStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "object_key" TEXT NOT NULL,
    "alt_text" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "width_px" INTEGER,
    "height_px" INTEGER,
    "byte_size" INTEGER,
    "content_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_user_id_idx" ON "addresses"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "categories_is_active_idx" ON "categories"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_status_published_at_idx" ON "products"("status", "published_at" DESC);

-- CreateIndex
CREATE INDEX "products_brand_idx" ON "products"("brand");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_sku_key" ON "product_variants"("sku");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_variants_status_idx" ON "product_variants"("status");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_option_key_key" ON "product_variants"("product_id", "option_key");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_object_key_key" ON "product_images"("object_key");

-- CreateIndex
CREATE INDEX "product_images_product_id_sort_order_idx" ON "product_images"("product_id", "sort_order");

-- CreateIndex
CREATE INDEX "product_images_variant_id_idx" ON "product_images"("variant_id");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- HAND-WRITTEN CONSTRAINTS — see the review rule in 20261021120000_identity.
-- ===========================================================================

-- --- Address ---------------------------------------------------------------
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_country_code_check" CHECK ("country_code" = upper("country_code") AND char_length(btrim("country_code")) = 2);
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_recipient_name_not_blank_check" CHECK (char_length(btrim("recipient_name")) > 0);
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_line1_not_blank_check" CHECK (char_length(btrim("line1")) > 0);
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_city_not_blank_check" CHECK (char_length(btrim("city")) > 0);
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_postal_code_not_blank_check" CHECK (char_length(btrim("postal_code")) > 0);

-- At most one default address per user. A partial unique index has no Prisma equivalent.
CREATE UNIQUE INDEX "addresses_one_default_per_user_key" ON "addresses"("user_id") WHERE "is_default";

-- --- Category --------------------------------------------------------------
-- Postgres cannot reject a deeper cycle (A -> B -> A) without a trigger; the catalog
-- service caps nesting depth. This only closes the one-row case.
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_not_self_check" CHECK ("parent_id" IS NULL OR "parent_id" <> "id");
ALTER TABLE "categories" ADD CONSTRAINT "categories_sort_order_check" CHECK ("sort_order" >= 0);
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_not_blank_check" CHECK (char_length(btrim("name")) > 0);
ALTER TABLE "categories" ADD CONSTRAINT "categories_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- --- Product ---------------------------------------------------------------
-- A published product without a publication timestamp would break catalog ordering and
-- any "new arrivals" query, so the two fields move together.
ALTER TABLE "products" ADD CONSTRAINT "products_published_requires_timestamp_check" CHECK ("status" <> 'PUBLISHED' OR "published_at" IS NOT NULL);
ALTER TABLE "products" ADD CONSTRAINT "products_name_not_blank_check" CHECK (char_length(btrim("name")) > 0);
ALTER TABLE "products" ADD CONSTRAINT "products_slug_format_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');

-- --- ProductVariant --------------------------------------------------------
-- stock_quantity >= 0 is the final guardrail behind the conditional decrement in
-- architecture.md §8: even a buggy service cannot oversell past zero.
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_stock_non_negative_check" CHECK ("stock_quantity" >= 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_price_minor_check" CHECK ("price_minor" >= 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_compare_at_price_check" CHECK ("compare_at_price_minor" IS NULL OR "compare_at_price_minor" >= 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_low_stock_threshold_check" CHECK ("low_stock_threshold" >= 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_weight_grams_check" CHECK ("weight_grams" IS NULL OR "weight_grams" > 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_sku_not_blank_check" CHECK (char_length(btrim("sku")) > 0);
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_option_key_not_blank_check" CHECK (char_length(btrim("option_key")) > 0);

-- --- ProductImage ----------------------------------------------------------
-- alt_text is required, not merely present: PRD §5 commits to accessible alternatives.
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_alt_text_not_blank_check" CHECK (char_length(btrim("alt_text")) > 0);
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_object_key_not_blank_check" CHECK (char_length(btrim("object_key")) > 0);
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_sort_order_check" CHECK ("sort_order" >= 0);
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_byte_size_check" CHECK ("byte_size" IS NULL OR "byte_size" > 0);
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_dimensions_check" CHECK (("width_px" IS NULL OR "width_px" > 0) AND ("height_px" IS NULL OR "height_px" > 0));
