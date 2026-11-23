# CommerceCore — Query cost review (M11)

- **Date:** 2026-11-14
- **Tool:** `backend/scripts/perf/explain.ts` (`npm run perf:explain`), repeatable.
- **Scope:** the queries a busy store runs most, measured with `EXPLAIN (ANALYZE, BUFFERS)` against
  PostgreSQL 17 on a development laptop. These are single-query timings on a warm cache with no
  concurrent load: they show which queries scale with table size and which do not. They are not a
  load test and say nothing about throughput or latency under traffic (M12).

## Defined volume

About five years of a busy single store, generated with `generate_series` into a throwaway
`commercecore_perf` database (the script refuses any database whose name lacks "perf"):

| Table | Rows |
|---|---:|
| products (90% published) | 20,000 |
| product_variants | 80,000 |
| product_images | 20,000 |
| users | 50,000 |
| orders | 250,000 |
| outbox_events | 500,000 |
| inventory_movements | 300,000 |

The development catalog today has 2,744 products, so the catalog numbers below are about seven
times today's size.

## How to run it

```bash
DATABASE_URL=postgresql://…/commercecore_perf npx prisma migrate deploy
DATABASE_URL=postgresql://…/commercecore_perf npm run perf:explain            # fill, then measure
DATABASE_URL=postgresql://…/commercecore_perf npm run perf:explain -- --no-fill # measure again
```

The catalog queries are the application's own SQL (`catalog.query.ts`); the others are the SQL the
named service issues, written out so the plan can be read.

## Results

Milliseconds, median of the runs taken; "before" is the code at the start of M11.

| Query | Before | After | Plan after |
|---|---:|---:|---|
| Catalog: default (`featured`) listing, page 1 | 1,033 | **2** | index `products_featured_rank_published_at_created_at_id_idx`, stops after one page |
| Catalog: default listing, total count | 528 | **90** | semi-joins on variants and images |
| Catalog: one category, page 1 | 54 | **1.5** | as above |
| Catalog: one category, count | 31 | **10** | |
| Catalog: men, price ascending, page 40 | 230–400 | 280–340 | every matching product's lowest price is computed, then sorted |
| Catalog: men, price ascending, count | 235 | **95–108** | |
| Catalog: search "linen coat", page 1 | 220–330 | 180–210 | sequential scan (`ILIKE '%…%'`) |
| Customer: own orders, newest first | 0.9 | 0.9 | `orders(user_id, created_at DESC)` |
| Admin: orders by status, page 1 | 0.1 | 0.1 | `orders(status, created_at DESC)` |
| Admin: orders by status, count | 18 | 15 | same index |
| Admin: order search by number or email | 270 | 270 | walks `orders(created_at)` filtering `ILIKE` |
| Admin: overview, last 30 days | 3 | 1 | `orders(created_at)` |
| Admin: customer search by email | 120 | 77 | sequential scan (`ILIKE '%…%'`) |
| Worker: claim due outbox jobs | 21 | 24 | `outbox_events(status, next_attempt_at)` |
| Admin: job summary by status | 108 | 90 | sequential scan, `GROUP BY status` |
| Admin: movements for one variant | 0.2 | 0.2 | `inventory_movements(variant_id, created_at DESC)` |
| Admin: low-stock inventory | 21 | 19 | sequential scan of variants |

## What changed

1. **The default listing's sort is now an index.** `featured` orders by
   `featured_rank ASC NULLS LAST, published_at DESC, created_at DESC, id DESC`. The old index
   covered only `featured_rank`, and nearly every product has none, so PostgreSQL computed the
   lowest price and checked images for all 17,677 published products, then kept 24. The new
   composite index matches the whole ORDER BY: the scan reads products in order and stops once a
   page passes the publication rule. Migration `catalog_featured_order_index`; it replaces the
   single-column index, which it also serves (the dark-edit query).
2. **Counts and facets no longer compute a price.** `LISTING_FROM` joins each product's lowest
   purchasable price, and the listing's count, the category counts and four of the five facets
   used it only for its side effect of dropping products with no sellable variant. That rule is
   now an `EXISTS` inside `PUBLIC_PRODUCT_SQL` (so the condition is complete whatever the FROM),
   and those queries use `MATCH_FROM`, without the price. Only the price sorts and the price-range
   facet still use `LISTING_FROM`.

`tests/integration/catalog.test.ts` and `search-suggestions.test.ts` run the same visible and
hidden fixtures through every listing path, so a change in which products appear would fail them.

## Not changed, and when to

| Query | Cost now | Grows with | Fix when it matters |
|---|---|---|---|
| Price sorts | ~300 ms at 20k products | published products | Store `min_price_minor` on `products`, maintained in the same transaction as variant price/status writes, and index it. Worth it past ~10k products. |
| Storefront text search | ~200 ms at 20k products | published products | `pg_trgm` GIN indexes on `products.name`, `brand`, `description` (and category names), or a `tsvector` column if relevance ranking is wanted. Worth it past ~10k products or if search becomes a main entry point. |
| Admin order search | ~270 ms at 250k orders | orders | Exact-match fast path when `q` looks like an order number, and a `pg_trgm` index on `contact_email`. Admin-only; acceptable today. |
| Admin customer search | ~80 ms at 50k users | users | `pg_trgm` on `users.email` and `name`. |
| Job summary | ~90 ms at 500k jobs | all outbox rows ever | Archive or delete `SENT` rows older than a retention window (also a privacy item, PRD §5); the claim query is already indexed. |
| Low-stock list | ~20 ms at 80k variants | variants | Fine. A partial index on `stock_quantity <= low_stock_threshold` is not expressible; a generated column would be. |

## Limits of this review

- Single-query timings on a warm laptop cache, not a load test. Concurrency, connection-pool
  sizing and p95 latency under traffic are M12.
- Synthetic data is evenly distributed. Real catalogs skew (a few large categories, popular
  search words), which changes selectivity; re-run against a copy of production data before launch.
- The admin and worker queries are hand-written equivalents of what Prisma issues; a change in
  the service code should be reflected in the script.
