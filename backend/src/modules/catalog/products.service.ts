import { Prisma, type ProductGender } from '@prisma/client';

import { env } from '../../config/env.js';
import { notFound } from '../../http/errors.js';
import { toSkipTake } from '../../http/schemas.js';
import { type ImageView, toImageView } from '../../lib/media.js';
import { prisma } from '../../lib/prisma.js';
import { LISTING_FROM, listingConditions, orderBySql, scopeConditions } from './catalog.query.js';
import type { GenderFilter, ProductFacetsQuery, ProductListQuery } from './catalog.schemas.js';
import {
  PURCHASABLE_VARIANT_WHERE,
  publicProductWhere,
  purchasableVariantSql,
} from './publication.js';
import { compareSizes, readOption } from './sizes.js';

/**
 * Public catalog reads (API_SPEC.md §4).
 *
 * What is deliberately NOT in any response here: stock counts, low-stock thresholds, the
 * price source (SYNTHETIC/MANUAL), product status, and every `source*` provenance field
 * (ADR 0011 decision 7). Availability is reported as a state, not a number.
 */

export type Availability = 'in_stock' | 'low_stock' | 'out_of_stock';

export interface CategoryRef {
  readonly slug: string;
  readonly name: string;
}

export interface ProductCardView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly brand: string | null;
  readonly gender: GenderFilter | null;
  readonly category: CategoryRef;
  readonly currency: string;
  /** Lowest purchasable variant price. */
  readonly priceMinor: number;
  /** Highest purchasable variant price; equal to `priceMinor` when there is one price. */
  readonly maxPriceMinor: number;
  readonly compareAtPriceMinor: number | null;
  readonly colors: readonly string[];
  readonly inStock: boolean;
  readonly image: ImageView | null;
}

export interface VariantView {
  readonly id: string;
  readonly sku: string;
  readonly color: string | null;
  readonly size: string | null;
  readonly priceMinor: number;
  readonly compareAtPriceMinor: number | null;
  readonly availability: Availability;
}

export interface ProductDetailView extends Omit<ProductCardView, 'image' | 'category'> {
  readonly description: string | null;
  readonly category: CategoryRef & { readonly parent: CategoryRef | null };
  readonly images: readonly ImageView[];
  readonly sizes: readonly string[];
  readonly variants: readonly VariantView[];
}

export interface FacetValue {
  readonly value: string;
  readonly count: number;
}

export interface ProductFacetsView {
  readonly total: number;
  readonly currency: string;
  readonly price: { readonly minMinor: number; readonly maxMinor: number } | null;
  readonly categories: readonly (CategoryRef & { readonly count: number })[];
  readonly colors: readonly FacetValue[];
  readonly sizes: readonly FacetValue[];
  readonly brands: readonly FacetValue[];
}

const GENDER_OUT: Record<ProductGender, GenderFilter> = {
  MEN: 'men',
  WOMEN: 'women',
  UNISEX: 'unisex',
};

export function availabilityOf(stockQuantity: number, lowStockThreshold: number): Availability {
  if (stockQuantity <= 0) return 'out_of_stock';
  if (stockQuantity <= lowStockThreshold) return 'low_stock';
  return 'in_stock';
}

function uniqueInOrder(values: readonly (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))];
}

interface PricedVariant {
  readonly priceMinor: number;
  readonly compareAtPriceMinor: number | null;
}

/** Price range of purchasable variants, and the cheapest one's genuine markdown, if any. */
function priceSummary(variants: readonly PricedVariant[]) {
  const sorted = [...variants].sort((a, b) => a.priceMinor - b.priceMinor);
  const cheapest = sorted[0];
  const dearest = sorted[sorted.length - 1];

  if (!cheapest || !dearest) {
    // Unreachable for a public product: the publication rule requires a purchasable variant.
    throw new Error('A public product has no purchasable variant');
  }

  const compareAt = cheapest.compareAtPriceMinor;

  return {
    priceMinor: cheapest.priceMinor,
    maxPriceMinor: dearest.priceMinor,
    compareAtPriceMinor: compareAt !== null && compareAt > cheapest.priceMinor ? compareAt : null,
  };
}

const CARD_SELECT = {
  id: true,
  slug: true,
  name: true,
  brand: true,
  gender: true,
  category: { select: { slug: true, name: true } },
  variants: {
    where: PURCHASABLE_VARIANT_WHERE,
    select: { options: true, priceMinor: true, compareAtPriceMinor: true, stockQuantity: true },
  },
  images: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    take: 1,
    select: { objectKey: true, altText: true, widthPx: true, heightPx: true },
  },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof CARD_SELECT }>;

function toCardView(row: CardRow): ProductCardView {
  const image = row.images[0];

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    brand: row.brand,
    gender: row.gender ? GENDER_OUT[row.gender] : null,
    category: row.category,
    currency: env.STORE_CURRENCY,
    ...priceSummary(row.variants),
    colors: uniqueInOrder(row.variants.map((variant) => readOption(variant.options, 'color'))),
    inStock: row.variants.some((variant) => variant.stockQuantity > 0),
    image: image ? toImageView(image) : null,
  };
}

export interface ProductPage {
  readonly items: readonly ProductCardView[];
  readonly total: number;
}

/**
 * Two short reads: the matching ids for one page (filtered, sorted and paginated in
 * PostgreSQL), then the card fields for just those ids. Only one page of products is ever
 * loaded, whatever the size of the catalog.
 */
export async function listProducts(filters: ProductListQuery): Promise<ProductPage> {
  const { skip, take } = toSkipTake(filters);
  const where = listingConditions(filters);

  const [countRows, idRows] = await Promise.all([
    prisma.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT COUNT(*)::int AS total ${LISTING_FROM} WHERE ${where}`,
    ),
    prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT p.id ${LISTING_FROM} WHERE ${where}
        ORDER BY ${orderBySql(filters.sort, filters.q)} LIMIT ${take} OFFSET ${skip}`,
    ),
  ]);

  const total = countRows[0]?.total ?? 0;
  const ids = idRows.map((row) => row.id);

  if (ids.length === 0) {
    return { items: [], total };
  }

  const rows = await prisma.product.findMany({
    where: { id: { in: ids } },
    select: CARD_SELECT,
  });

  // `IN (...)` does not preserve order; restore the SQL sort.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const items = ids
    .map((id) => byId.get(id))
    .filter((row): row is CardRow => row !== undefined && row.variants.length > 0)
    .map(toCardView);

  return { items, total };
}

const DETAIL_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  brand: true,
  gender: true,
  category: {
    select: { slug: true, name: true, parent: { select: { slug: true, name: true } } },
  },
  variants: {
    where: PURCHASABLE_VARIANT_WHERE,
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      sku: true,
      options: true,
      priceMinor: true,
      compareAtPriceMinor: true,
      stockQuantity: true,
      lowStockThreshold: true,
    },
  },
  images: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { objectKey: true, altText: true, widthPx: true, heightPx: true },
  },
} satisfies Prisma.ProductSelect;

export async function getPublicProduct(slug: string): Promise<ProductDetailView> {
  const row = await prisma.product.findFirst({
    where: { slug, ...publicProductWhere() },
    select: DETAIL_SELECT,
  });

  // A draft, an archived product and a missing slug all answer the same 404, so the API
  // never confirms that an unpublished product exists.
  if (!row) {
    throw notFound('That product does not exist.');
  }

  const variants: VariantView[] = row.variants
    .map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      color: readOption(variant.options, 'color'),
      size: readOption(variant.options, 'size'),
      priceMinor: variant.priceMinor,
      compareAtPriceMinor:
        variant.compareAtPriceMinor !== null && variant.compareAtPriceMinor > variant.priceMinor
          ? variant.compareAtPriceMinor
          : null,
      availability: availabilityOf(variant.stockQuantity, variant.lowStockThreshold),
    }))
    .sort((a, b) => compareSizes(a.size ?? '', b.size ?? ''));

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    brand: row.brand,
    gender: row.gender ? GENDER_OUT[row.gender] : null,
    category: { slug: row.category.slug, name: row.category.name, parent: row.category.parent },
    currency: env.STORE_CURRENCY,
    ...priceSummary(row.variants),
    colors: uniqueInOrder(variants.map((variant) => variant.color)),
    sizes: uniqueInOrder(variants.map((variant) => variant.size)),
    inStock: variants.some((variant) => variant.availability !== 'out_of_stock'),
    images: row.images.map(toImageView),
    variants,
  };
}

/** Brands are a long tail; the filter lists the most stocked ones. */
const BRAND_FACET_LIMIT = 40;

/**
 * Filter options for the products in scope (gender, category, search). Counts are of
 * products, not variants. Colour, size and brand selections do not narrow the facets, so
 * choosing "Black" does not hide the other colours from the picker.
 */
export async function getProductFacets(filters: ProductFacetsQuery): Promise<ProductFacetsView> {
  const scope = Prisma.join(scopeConditions(filters), ' AND ');
  const categoryScope = Prisma.join(scopeConditions(filters, { ignoreCategory: true }), ' AND ');

  const [summary, categories, colors, sizes, brands] = await Promise.all([
    prisma.$queryRaw<{ total: number; min: number | null; max: number | null }[]>(Prisma.sql`
      SELECT COUNT(*)::int AS total, MIN(price.min_price)::int AS min, MAX(price.min_price)::int AS max
      ${LISTING_FROM} WHERE ${scope}`),
    prisma.$queryRaw<{ slug: string; name: string; count: number }[]>(Prisma.sql`
      SELECT c.slug, c.name, COUNT(*)::int AS count
      ${LISTING_FROM} WHERE ${categoryScope}
      GROUP BY c.slug, c.name ORDER BY count DESC, c.name ASC`),
    prisma.$queryRaw<FacetValue[]>(Prisma.sql`
      SELECT fv.options->>'color' AS value, COUNT(DISTINCT p.id)::int AS count
      ${LISTING_FROM}
      JOIN product_variants fv ON fv.product_id = p.id AND ${purchasableVariantSql('fv')}
      WHERE ${scope} AND fv.options->>'color' IS NOT NULL
      GROUP BY 1 ORDER BY count DESC, value ASC`),
    prisma.$queryRaw<FacetValue[]>(Prisma.sql`
      SELECT upper(fv.options->>'size') AS value, COUNT(DISTINCT p.id)::int AS count
      ${LISTING_FROM}
      JOIN product_variants fv ON fv.product_id = p.id AND ${purchasableVariantSql('fv')}
      WHERE ${scope} AND fv.options->>'size' IS NOT NULL
      GROUP BY 1`),
    prisma.$queryRaw<FacetValue[]>(Prisma.sql`
      SELECT p.brand AS value, COUNT(*)::int AS count
      ${LISTING_FROM} WHERE ${scope} AND p.brand IS NOT NULL
      GROUP BY 1 ORDER BY count DESC, value ASC LIMIT ${BRAND_FACET_LIMIT}`),
  ]);

  const totals = summary[0];

  return {
    total: totals?.total ?? 0,
    currency: env.STORE_CURRENCY,
    price:
      totals && totals.min !== null && totals.max !== null
        ? { minMinor: totals.min, maxMinor: totals.max }
        : null,
    categories,
    colors,
    sizes: [...sizes].sort((a, b) => compareSizes(a.value, b.value)),
    brands: [...brands].sort((a, b) => a.value.localeCompare(b.value)),
  };
}
