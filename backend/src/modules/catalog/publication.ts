import { Prisma, ProductStatus, ProductVariantStatus } from '@prisma/client';

/**
 * The publication rule: when a product may be shown to the public or put in a cart
 * (fashion-catalog-integration-plan.md §5.4, ADR 0011 decision 6).
 *
 * A product is public only when ALL of these hold:
 *   1. status is PUBLISHED and publishedAt is not in the future;
 *   2. its category is active, and so is that category's parent, if it has one;
 *   3. it has at least one image;
 *   4. it has at least one ACTIVE variant with a price above zero.
 *
 * The importer applies the same rule before it publishes, but the API does not trust that:
 * a status flipped by hand, a category switched off or an image deleted must take the
 * product out of the storefront immediately, without anyone remembering to unpublish it.
 *
 * The rule exists twice — as a Prisma `where` for single-row reads and as SQL for the
 * listing, which needs aggregates Prisma cannot express. Both live in this file so they are
 * changed together, and `tests/integration/catalog.test.ts` runs the same hidden fixtures
 * through the listing, the detail and the cart so a drift between them fails a test.
 */

/** A variant that can be sold: ACTIVE and priced. */
export const PURCHASABLE_VARIANT_WHERE = {
  status: ProductVariantStatus.ACTIVE,
  priceMinor: { gt: 0 },
} satisfies Prisma.ProductVariantWhereInput;

export function publicProductWhere(now: Date = new Date()): Prisma.ProductWhereInput {
  return {
    status: ProductStatus.PUBLISHED,
    publishedAt: { not: null, lte: now },
    category: {
      isActive: true,
      OR: [{ parentId: null }, { parent: { isActive: true } }],
    },
    images: { some: {} },
    variants: { some: PURCHASABLE_VARIANT_WHERE },
  };
}

/**
 * SQL form, for queries that alias `products p`, `categories c` (the product's category)
 * and `LEFT JOIN categories pc` (its parent). Rule 4 is enforced by the caller's join to
 * purchasable variants (`PURCHASABLE_VARIANT_SQL`), which every listing query needs anyway.
 *
 * `published_at` is a timestamp without time zone holding UTC (Prisma's convention), so it
 * is compared with UTC "now" rather than with `now()`, whose result depends on the session
 * time zone.
 */
export const PUBLIC_PRODUCT_SQL = Prisma.sql`
  p.status = 'PUBLISHED'
  AND p.published_at IS NOT NULL
  AND p.published_at <= (now() AT TIME ZONE 'UTC')
  AND c.is_active
  AND (c.parent_id IS NULL OR pc.is_active)
  AND EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id)
`;

/** For a `product_variants` alias `v`. */
export function purchasableVariantSql(alias: string): Prisma.Sql {
  // The alias is a code constant, never caller input; `Prisma.raw` only places it.
  if (!/^[a-z]+$/.test(alias)) {
    throw new Error(`Invalid SQL alias: ${alias}`);
  }

  const v = Prisma.raw(alias);
  return Prisma.sql`${v}.status = 'ACTIVE' AND ${v}.price_minor > 0`;
}
