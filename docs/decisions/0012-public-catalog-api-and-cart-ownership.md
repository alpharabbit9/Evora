# ADR 0012 — Public Catalog Queries and Cart Ownership

- **Status:** Accepted
- **Date:** 2026-10-27
- **Context documents:** [`fashion-catalog-integration-plan.md`](../fashion-catalog-integration-plan.md)
  (Phase 3), [ADR 0004](0004-inventory-policy.md), [ADR 0011](0011-catalog-import-provenance.md)

## Context
Phase 3 of the fashion catalog work needed a public catalog API, a storefront on top of it, and
add-to-cart that is validated on the server. The plan's decision D7 had deferred the cart to M5;
the Phase 3 brief requires add-to-cart and server-validated price and stock, so the cart's core
(persistence, ownership, validation) was built now. Checkout (M6) was not: ADR 0004 is still open.

## Decision
1. **One publication rule, enforced in every public query** — PUBLISHED with a past
   `publishedAt`, active category and active parent, at least one image, at least one ACTIVE
   variant priced above zero (`modules/catalog/publication.ts`). It exists as a Prisma `where`
   and as SQL in the same file; the cart uses the Prisma form for "can this be sold". A product
   that fails any part answers the same 404 as a slug that never existed.
2. **Listing in parameterised SQL.** Sorting by a product's lowest purchasable price and
   filtering JSON variant options cannot be expressed in Prisma's query API without loading
   every candidate. The listing reads one page of ids in PostgreSQL, then card fields for those
   ids only. Sort keys are an allow-listed enum mapped to fixed ORDER BY fragments.
3. **Variant filters apply to one variant.** "Black, UK8, in stock" matches a product only if a
   single variant is all three.
4. **No stock numbers in public responses.** Availability is `in_stock | low_stock |
   out_of_stock`; cart lines carry a status. Provenance and `priceSource` are never returned
   (ADR 0011 decision 7); the storefront labels the whole catalog as demo data instead.
5. **Guest cart credential:** 32 random bytes in an httpOnly cookie scoped to `/api/v1/cart`,
   stored as a SHA-256 hash (`carts.guest_token_hash`), 30-day expiry refreshed on writes.
6. **Merge on the next cart request**, not a separate `POST /cart/merge`: the browser cannot see
   the httpOnly cookie, so it cannot know when to call a merge endpoint. The merge deletes the
   guest cart first with a conditional delete, so concurrent requests merge once.
7. **The cart stores no price.** Every cart response is re-priced from `product_variants`.
   Stock is checked on add and on raising a quantity, never reserved.
8. **No new index or cache.** Measured on the 2,692-product dev catalog: filtered listing 6 ms,
   two-word search with count 23 ms, deep page (offset 2,400) 13 ms (`EXPLAIN ANALYZE`). The
   existing indexes on `product_variants(product_id)`, `product_images(product_id, sort_order)`
   and `products(category_id)` carry these plans.

## Consequences
- A price change is visible in every cart immediately; there is no "price changed since you
  added it" notice, because nothing records the earlier price. Add a snapshot column if that
  notice becomes a requirement.
- Two carts can hold the last unit at once. Checkout (M6) must claim stock atomically inside its
  own transaction regardless of what the cart said.
- `GET /cart` can write (the merge). It only ever moves the caller's own guest items into the
  caller's own account cart and is idempotent, so a cross-site GET cannot do more than the
  customer's next request would.
- Search is `ILIKE` across name, brand, description, category and colour, with a relevance
  order. Revisit with `pg_trgm` or full-text search when the catalog grows by an order of
  magnitude or `EXPLAIN` shows the scan dominating.
- Expired guest carts are ignored, not deleted. Cleaning them up belongs to the M9 job runner.

## Alternatives
- Denormalising `min_price_minor` onto `products` — would let Prisma sort, but adds a value
  every price write must keep in sync.
- Storing the guest cart in `localStorage` — simpler, but the server could not own it, and
  merging after sign-in would mean trusting a client-supplied list.
