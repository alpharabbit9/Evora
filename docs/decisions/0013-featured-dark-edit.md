# ADR 0013 — Featured Ordering and the Synthetic "Dark Edit"

- **Status:** Accepted
- **Date:** 2026-10-29
- **Related:** [ADR 0011](0011-catalog-import-provenance.md), [ADR 0012](0012-public-catalog-api-and-cart-ownership.md), [`fashion-catalog-setup.md` §14](../fashion-catalog-setup.md)

## Context
The development catalog (Kaggle "Fashion Product Images", ADR 0011) is dominated by T-shirts, shirts
and sneakers, while the store's look is dark outerwear, tailoring and boots. The source has essentially
no leather or bomber jackets, coats or Chelsea/combat boots, and those gaps are documented rather than
filled by relabelling source rows. The owner asked for a 35–40 piece dark-fashion set — blazers, boots,
leather and bomber jackets, coats, hoodies — that leads the home page and the product listings, with the
existing catalog following it.

## Decision
1. **`Product.featuredRank`** — nullable integer, `CHECK (featured_rank IS NULL OR featured_rank > 0)`,
   indexed. 1 is shown first; NULL is not featured. A column rather than a separate "collection" table:
   there is one featured list today, and a column keeps the listing a single query.
2. **`sort=featured`** — `featured_rank ASC NULLS LAST`, then the `newest` order. It is the default for a
   listing without a search; `relevance` (searches) uses it to break score ties. `newest` ignores the
   rank, so `/collections/new` is unchanged. Filters still apply first, so `/shop?category=boots` lists
   the featured boots first.
3. **The Dark Edit** is a hand-written dataset (`backend/scripts/catalog-import/curated/dark-edit.json`,
   40 items) imported by `npm run catalog:dark-edit` through the existing `persistProduct` — same
   transactions, rerun rule, publication rule and inventory ledger as the Kaggle import. Provider
   `commercecore-dark-edit`, SKUs `EV-DE0nn-<size>`, house brand `EVORA`.
4. **It is labelled synthetic.** Names, copy, sizes and brand are invented; prices and stock are
   `SYNTHETIC` (new BDT bands for `coats` and `hoodies`). Only the photos are real: Unsplash photos under
   the Unsplash License, downloaded from `images.unsplash.com` only, validated by their bytes, stored in
   object storage, and credited per image (`ProductImage.attribution`, `sourceUrl` = the photo page).
5. `featuredRank` follows the importer's create-only rule: a rerun never rewrites it, so a merchandiser's
   later change survives. Public endpoints do not return it.

## Consequences
- Every listing has a deterministic front: the 40 front-runners, then the catalog by recency.
- Re-ordering the edit after import needs a database edit (or the future admin catalog API, M3
  remainder) — changing `rank` in the JSON does not move an existing product.
- Two new categories, `coats` (under Outerwear) and `hoodies` (under Tops). No Kaggle rule maps to them.
- Removing the edit is a targeted delete by `source_provider = 'commercecore-dark-edit'`, as in
  `fashion-catalog-setup.md` §7.
- Like the rest of the demo catalog, this is not a real product range and must not be deployed as one.

## Alternatives
- **Boost by sorting on category** — would promote every Kaggle jacket and boot, not a chosen set.
- **A hard-coded list of slugs in the frontend** — the home page and `/shop` would disagree, and the
  backend would not know what "featured" means.
- **Relabelling Kaggle rows as leather/bomber/coats** — rejected in ADR 0011 (decision D6); nothing is
  relabelled to suit the brand.
