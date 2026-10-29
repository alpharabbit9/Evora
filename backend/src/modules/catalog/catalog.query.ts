import { Prisma } from '@prisma/client';

import type {
  GenderFilter,
  ProductFacetsQuery,
  ProductListQuery,
  ProductSort,
} from './catalog.schemas.js';
import { PUBLIC_PRODUCT_SQL, purchasableVariantSql } from './publication.js';

/**
 * SQL building blocks for the public product listing and its facets.
 *
 * The listing is raw SQL because it sorts by an aggregate (a product's lowest purchasable
 * price) and filters on JSON variant options, neither of which Prisma's query API can express
 * without loading every candidate row into memory. Everything here is composed with
 * `Prisma.sql`, so every caller-supplied value is a bound parameter; the only fragments that
 * are not parameters are the allow-listed ORDER BY clauses below.
 *
 * Aliases used throughout: `p` products, `c` the product's category, `pc` its parent
 * category, and `price` the per-product lowest purchasable price.
 */

/**
 * `JOIN LATERAL ... ON price.min_price IS NOT NULL` drops products with no purchasable
 * variant, which is rule 4 of the publication rule (`publication.ts`).
 */
export const LISTING_FROM = Prisma.sql`
  FROM products p
  JOIN categories c ON c.id = p.category_id
  LEFT JOIN categories pc ON pc.id = c.parent_id
  JOIN LATERAL (
    SELECT MIN(v.price_minor) AS min_price
    FROM product_variants v
    WHERE v.product_id = p.id AND ${purchasableVariantSql('v')}
  ) price ON price.min_price IS NOT NULL
`;

/**
 * Men's and women's collections include unisex items — a unisex belt is on both shelves.
 * An explicit `unisex` filter shows only those.
 */
const GENDERS_FOR_FILTER: Record<GenderFilter, readonly string[]> = {
  men: ['MEN', 'UNISEX'],
  women: ['WOMEN', 'UNISEX'],
  unisex: ['UNISEX'],
};

const NEWEST = Prisma.sql`p.published_at DESC, p.created_at DESC, p.id DESC`;

const ORDER_BY: Record<Exclude<ProductSort, 'relevance'>, Prisma.Sql> = {
  // Featured products by rank (1 first), then everything else exactly as `newest`.
  featured: Prisma.sql`p.featured_rank ASC NULLS LAST, ${NEWEST}`,
  newest: NEWEST,
  price_asc: Prisma.sql`price.min_price ASC, p.id ASC`,
  price_desc: Prisma.sql`price.min_price DESC, p.id DESC`,
  name_asc: Prisma.sql`p.name ASC, p.id ASC`,
};

/**
 * `relevance` is the default when there is a search, and means `featured` when there is not.
 * Description matches are allowed to qualify a product but add nothing to its score, so
 * "black boots" puts boots before a sweatshirt whose copy suggests wearing it with boots. Equal
 * scores fall back to `featured`.
 */
export function orderBySql(sort: ProductSort | undefined, q: string | undefined): Prisma.Sql {
  const effective = sort ?? (q ? 'relevance' : 'featured');

  if (effective !== 'relevance') {
    return ORDER_BY[effective];
  }

  if (!q) {
    return ORDER_BY.featured;
  }

  const score = searchTerms(q).map((term) => {
    const pattern = likePattern(term);
    return Prisma.sql`(
      CASE WHEN p.name ILIKE ${pattern} THEN 4 ELSE 0 END
      + CASE WHEN c.name ILIKE ${pattern} OR pc.name ILIKE ${pattern} THEN 3 ELSE 0 END
      + CASE WHEN p.brand ILIKE ${pattern} THEN 2 ELSE 0 END
    )`;
  });

  return Prisma.sql`(${Prisma.join(score, ' + ')}) DESC, ${ORDER_BY.featured}`;
}

/** At most this many words of a search are used; the rest are ignored, not an error. */
const MAX_SEARCH_TERMS = 5;

/** `%`, `_` and the escape character itself are literal in a search, not wildcards. */
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

export function searchTerms(q: string): string[] {
  return [...new Set(q.toLowerCase().split(/\s+/).filter(Boolean))].slice(0, MAX_SEARCH_TERMS);
}

/**
 * Every search word has to match somewhere — name, brand, description, category, parent
 * category or a variant colour — so "black boots" finds black items in Boots rather than
 * everything black or everything in Boots.
 */
function searchCondition(q: string): Prisma.Sql {
  const perTerm = searchTerms(q).map((term) => {
    const pattern = likePattern(term);
    return Prisma.sql`(
      p.name ILIKE ${pattern}
      OR p.brand ILIKE ${pattern}
      OR p.description ILIKE ${pattern}
      OR c.name ILIKE ${pattern}
      OR pc.name ILIKE ${pattern}
      OR EXISTS (
        SELECT 1 FROM product_variants qv
        WHERE qv.product_id = p.id AND ${purchasableVariantSql('qv')}
          AND qv.options->>'color' ILIKE ${pattern}
      )
    )`;
  });

  return Prisma.join(perTerm, ' AND ');
}

interface ScopeOptions {
  /** Facets for the category list ignore the selected category, so siblings stay visible. */
  readonly ignoreCategory?: boolean;
}

/** Publication rule plus the filters that define "which products are we looking at". */
export function scopeConditions(
  filters: ProductFacetsQuery,
  options: ScopeOptions = {},
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [PUBLIC_PRODUCT_SQL];

  if (filters.gender) {
    conditions.push(
      Prisma.sql`p.gender::text IN (${Prisma.join(GENDERS_FOR_FILTER[filters.gender])})`,
    );
  }

  if (filters.category && options.ignoreCategory !== true) {
    // Two levels: the category itself, or a child of it. The catalog service caps nesting.
    conditions.push(Prisma.sql`(c.slug = ${filters.category} OR pc.slug = ${filters.category})`);
  }

  if (filters.q) {
    conditions.push(searchCondition(filters.q));
  }

  return conditions;
}

/**
 * Variant-level filters are applied to ONE variant at a time: "black, size M, under ৳3,000,
 * in stock" matches a product only if a single variant is all of those, not if one variant
 * is black and a different one is size M.
 */
function variantCondition(filters: ProductListQuery): Prisma.Sql | undefined {
  const parts: Prisma.Sql[] = [];

  if (filters.color) {
    parts.push(Prisma.sql`fv.options->>'color' IN (${Prisma.join(filters.color)})`);
  }
  if (filters.size) {
    // Upper-cased on both sides: the source spells the same size `UK9` and `uk9`.
    parts.push(Prisma.sql`upper(fv.options->>'size') IN (${Prisma.join(filters.size)})`);
  }
  if (filters.minPrice !== undefined) {
    parts.push(Prisma.sql`fv.price_minor >= ${filters.minPrice}`);
  }
  if (filters.maxPrice !== undefined) {
    parts.push(Prisma.sql`fv.price_minor <= ${filters.maxPrice}`);
  }
  if (filters.inStock === true) {
    parts.push(Prisma.sql`fv.stock_quantity > 0`);
  }

  if (parts.length === 0) {
    return undefined;
  }

  return Prisma.sql`EXISTS (
    SELECT 1 FROM product_variants fv
    WHERE fv.product_id = p.id AND ${purchasableVariantSql('fv')}
      AND ${Prisma.join(parts, ' AND ')}
  )`;
}

export function listingConditions(filters: ProductListQuery): Prisma.Sql {
  const conditions = scopeConditions(filters);

  if (filters.brand) {
    conditions.push(Prisma.sql`p.brand IN (${Prisma.join(filters.brand)})`);
  }

  const variants = variantCondition(filters);
  if (variants) {
    conditions.push(variants);
  }

  return Prisma.join(conditions, ' AND ');
}
