# ADR 0011 — Catalog Import: Provenance, Gender and Synthetic Demo Data

- **Status:** Accepted
- **Date:** 2026-10-27
- **Context document:** [`docs/fashion-catalog-integration-plan.md`](../fashion-catalog-integration-plan.md)

## Context
M3 needs a large, repeatable catalog import. The chosen source (Kaggle "Fashion Product Images",
see the plan §2–3) has gender, category and colour labels but **no trustworthy price, no stock**,
and its images carry licence limits that restrict it to development and a labelled demo.
The schema had nowhere to record where a product came from, which gender it targets, or whether a
price is real — so a rerun could not find its own rows, a filter could not ask "men's footwear",
and a demo price would be indistinguishable from a merchandiser's.

## Decision
1. `Product.gender` — enum `MEN | WOMEN | UNISEX`, nullable (not every product has one). A column,
   not a category subtree, so categories are not duplicated per gender.
2. `Product.sourceProvider` + `Product.sourceExternalId`, unique together, both-or-neither (CHECK).
   That pair is the importer's idempotency key. `sourceUrl` and `sourceContentHash` sit beside it;
   the hash is of the descriptive fields the importer last wrote, so a rerun can tell an admin's
   edit (hash no longer matches) from untouched imported copy and skip the former.
3. `ProductVariant.priceSource` — enum `MANUAL | SOURCE | SYNTHETIC`, default `MANUAL`. Demo
   prices are `SYNTHETIC` and the storefront may label them. Existing rows become `MANUAL`.
4. `ProductImage.sourceUrl` and `attribution` — provenance for images that came from a dataset.
5. Imported rows follow the seed's rerun rule: operational fields (price, stock, threshold,
   statuses, category) are written **only on create**. Synthetic stock is written together with an
   `InventoryMovement` (`IMPORT_CORRECTION`) in the same transaction, so the ledger reconciles.
6. A product is published only when it has an active category, an image and an `ACTIVE` priced
   variant. The importer creates drafts and promotes only rows that pass.
7. Provenance fields are internal: never returned by public catalog endpoints.

## Consequences
- Every imported row is identifiable (`source_provider`), which makes a targeted rollback possible.
- A second source is a new adapter emitting the same normalised record, not a schema change.
- `priceSource` is advisory data, not a pricing rule: checkout (M6) still reads `priceMinor` and
  must not treat `SYNTHETIC` specially — the label exists for humans and the storefront.
- The catalog built from this source must not be deployed as a real store (plan §3).

## Alternatives
- Separate `ProductSource` table — cleaner if a product ever had several sources; today it has at
  most one, and a 1:1 table only adds a join.
- Gender as `men/…` and `women/…` category branches — duplicates every category and makes
  "unisex" awkward.
- Nullable `priceMinor` for unpriced imports — weakens an invariant every future pricing path
  relies on; drafts with synthetic flagged prices were chosen instead (decision D3).
