# Fashion Catalog — Setup and Import

How to load the development fashion catalog into CommerceCore's database. Background,
source comparison and licensing are in [`fashion-catalog-integration-plan.md`](fashion-catalog-integration-plan.md);
schema decisions are in [ADR 0011](decisions/0011-catalog-import-provenance.md).

> **Development / demo data only.** Product photos and brand names come from the Kaggle
> "Fashion Product Images" dataset, whose imagery originates from a retailer (Myntra). Its MIT label
> is the uploader's and does not grant commercial rights to the photos. Do not deploy this
> catalog as a real store. The importer refuses `NODE_ENV=production`.

## 1. Source

| | |
|---|---|
| Dataset | [Fashion Product Images Dataset](https://www.kaggle.com/datasets/paramaggarwal/fashion-product-images-dataset), Param Aggarwal, Kaggle |
| Licence (as labelled) | MIT; imagery originates from Myntra — see the warning above |
| Files used | `fashion-dataset/styles.csv` (44,446 rows), `fashion-dataset/styles/<id>.json`, `fashion-dataset/images/<id>.jpg` |
| Not used | The JSON's `price`/`discountedPrice` (no currency is stated, and nothing is converted — ADR 0008); retailer CDN image URLs |

## 2. One-time setup

1. Apply migrations (adds gender, provenance and price-source columns):
   ```bash
   cd backend && npm run prisma:deploy
   ```
2. Create a Kaggle API token: kaggle.com → Settings → **Create New Token**. Put the two values
   in `backend/.env` (gitignored):
   ```dotenv
   KAGGLE_USERNAME=your-kaggle-username
   KAGGLE_KEY=the-api-key-from-kaggle.json
   STORE_CURRENCY=BDT
   ```
   Only the API key is used. **Do not store your Kaggle password** in `.env`.
   *Alternative without a token:* download and extract the archive yourself so that
   `backend/.data/catalog/fashion-product-images/` contains `styles.csv`, `styles/` and `images/`.
3. Storage: by default images are written to `backend/.data/media/` (`STORAGE_DRIVER=filesystem`).
   For MinIO/R2/S3 set `STORAGE_DRIVER=s3` and the `S3_*` variables (see `.env.example`).

### Environment variables (names only — values live in `.env` files, never in git)

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_TEST` | backend | Dev database; separate test database (the DB and integration suites truncate it) |
| `STORE_CURRENCY` | backend | `BDT`, the only accepted value (ADR 0008) |
| `KAGGLE_USERNAME`, `KAGGLE_KEY` | backend | Kaggle API token, for downloads only; not needed once files are cached |
| `CATALOG_DATA_DIR` | backend | Download cache and import reports (default `.data/catalog`) |
| `STORAGE_DRIVER`, `MEDIA_ROOT` | backend | `filesystem` (dev, `.data/media`) or `s3` |
| `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | backend | Only for `s3` |
| `MEDIA_PUBLIC_URL` | backend | Base URL for image URLs in API responses; required for `s3`, defaults to `BETTER_AUTH_URL/media` |
| `NEXT_PUBLIC_API_URL` | frontend | API origin |
| `NEXT_PUBLIC_MEDIA_URL` | frontend | Image origin + path allowed by `next/image`; defaults to `NEXT_PUBLIC_API_URL/media` |

## 3. Running the importer

```bash
cd backend
npm run catalog:import -- --dry-run --demo-pricing --demo-stock --publish   # rehearse; writes nothing
npm run catalog:import -- --demo-pricing --demo-stock --publish             # real import
```

| Flag | Effect |
|---|---|
| `--dry-run` | Runs every database write and then rolls each transaction back; no storage writes. Downloads still go to the local cache. |
| `--stage=acquire` | Download and validate only; no storage or database writes. |
| `--demo-pricing` | New variants get a **synthetic** price in `STORE_CURRENCY` bands (BDT only), marked `priceSource = SYNTHETIC`. Without it no variant can be created (price is required), so products stay drafts. |
| `--demo-stock` | New variants get synthetic stock (≈10% start at 0) and an `IMPORT_CORRECTION` inventory movement. Requires `--demo-pricing`. |
| `--publish` | Publishes drafts that pass the rule: active category, an image, and an `ACTIVE` priced variant. |
| `--limit=<n>` | At most *n* products, mixed across categories. |
| `--category=<slug>` | Restrict to a category (repeatable), e.g. `--category=boots`. |
| `--concurrency=<n>` | Parallel downloads, 1–8 (default 2). Kaggle answers HTTP 429 to bursts; the client pauses all downloads and retries. |

Each run writes a JSON report to `backend/.data/catalog/reports/` and prints a summary.
The exit code is 1 if any product failed.

## 4. What gets imported

Curation rules live in `backend/scripts/catalog-import/taxonomy.ts`:

- Adult lines only (Men, Women, Unisex; the detail's `ageGroup` must be `Adults-*`).
- No ethnic wear and no sports apparel.
- An item is included only if **its own source colour** is in the category's dark palette.
  Nothing is relabelled.
- Identical title + colour + line in one category is treated as a duplicate listing.
- Per-category caps (≈3,000 products in total), newest catalog year first, women and men interleaved.
- Sizes come from the source's `styleOptions`. A lone "Onesize" means no size option, and sizes are never invented.

Mapping: `productDisplayName` → name; `brandName` → brand (null if absent); descriptor HTML →
plain-text description (null if absent); `gender` → `Product.gender`; `baseColour` → variant
`options.color`; size → `options.size`; SKU `FPI-<id>[-<SIZE>]`; slug `<name>-<id>`.

## 5. Rerun rules

Rerunning is safe and is how you add new flags later. For example, a run without `--demo-pricing`
followed by one with it adds the missing variants.

- **Never rewritten:** price, price source, stock, low-stock threshold, variant status, product status/publication, category.
- **Refreshed:** name, description, brand, gender, source URL. Exception: if an admin edited those fields, the product is reported as `skippedLocalOverride` and left alone.
- **Added if missing:** variants the source lists, and the image when the product has none.
- **Never deleted:** products absent from a later run are counted in `notSeenThisRun`.
- A product an admin unpublished is not republished.
- Downloads are cached; storage writes are keyed (`catalog/fashion-product-images/<id>/1.jpg`), so nothing is stored twice.

## 6. Images

The original JPEG is validated by its bytes (format sniffing, dimensions ≥ 300 px, ≤ 10 MB) and
stored unchanged. Responsive sizes and WebP are produced at request time by `next/image` (Phase 3),
so no image library was added to the backend. An image that is missing or fails validation does not
block the product. The product is imported but stays unpublished. `ProductImage` stores the object key,
dimensions, byte size, content type, the dataset path (`sourceUrl`) and an attribution line.

## 7. Rollback (development)

Every imported row has `source_provider = 'fashion-product-images'`. No order or cart can
reference these variants yet (M5/M6 are not built), so on a dev database:

```sql
-- Review first; destructive. Requires explicit authorisation outside local development.
DELETE FROM inventory_movements WHERE variant_id IN (
  SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
  WHERE p.source_provider = 'fashion-product-images');
DELETE FROM products WHERE source_provider = 'fashion-product-images';  -- cascades variants/images
```

Then delete `backend/.data/media/catalog/fashion-product-images/`. Categories created by the importer are left in place.

## 8. Tests

```bash
npm test                 # includes tests/catalog-import.test.ts (parsing, rules, pricing, images, storage)
npm run test:db          # includes tests/db/catalog-import.test.ts (rerun, overrides, dry run, rollback,
                         #   partial network failure + recovery, duplicate listings, publication parity)
npm run test:integration # tests/integration/catalog.test.ts and cart.test.ts (Phase 3)
```

## 9. Results of the first development import (2026-10-27)

| | |
|---|---|
| Source rows examined | 44,446 (0 invalid, 0 duplicate ids) |
| Excluded | off-brief type 17,564 · off-palette colour 11,845 · ethnic 3,190 · kids 1,512 · sportswear 1,071 · duplicate listings 3,307 · over cap 3,261 |
| Imported | **2,696 products** (2,692 published, 4 drafts without a usable image) · 9,381 variants · 2,692 images · 8,462 stock movements · 24 categories |
| Gender | Men 1,398 · Women 1,022 · Unisex 276 |
| Categories | t-shirts 300 · shirts 250 · trousers 250 · sneakers 250 · sunglasses 250 · knitwear 200 · formal-shoes 200 · wallets 200 · handbags 200 · belts 150 · jeans 96 · jackets 88 · messenger-bags 77 · dresses 74 · jewellery 48 · duffel-bags 41 · boots 16 · blazers 6 |
| Prices | ৳900–৳14,250, all `SYNTHETIC`; 919 variants start sold out |
| Images | 2,692 originals, ~858 MB in `backend/.data/media/`; 1 missing, 3 under 300 px |
| Rerun | 0 inserted, 2,696 unchanged, 0 rows added (31 s from cache) |
| Integrity | 0 published-without-variant/image, 0 duplicate slugs/SKUs/source ids, 0 image/product mismatches, stock = ledger sum for every variant |

## 10. Storefront and API (Phase 3)

With both servers running (`README.md`), the catalog is browsable at:

| Page | Reads |
|---|---|
| `/shop`, `/collections/men`, `/collections/women`, `/collections/new` | `GET /api/v1/products`, `/products/facets`, `/categories` |
| `/search?q=…` | same, ordered by relevance |
| `/products/<slug>` | `GET /api/v1/products/<slug>` (server-rendered, not cached) |
| `/cart` | `GET/POST/PATCH/DELETE /api/v1/cart…` |

Filters live in the URL (`/shop?category=boots&color=Black&size=UK8&min=2000&max=6000&inStock=true`;
`min`/`max` are whole taka in the URL and are sent to the API as poisha). The API contract is in
`docs/API_SPEC.md` §4–5 and the design in ADR 0012.

**Images:** with `STORAGE_DRIVER=filesystem` the API serves `MEDIA_ROOT` at `/media`, and API responses
carry absolute URLs built from `MEDIA_PUBLIC_URL` (default `BETTER_AUTH_URL/media`). The frontend's
`next/image` resizes them on request; `next.config.ts` allows exactly that origin and path
(`NEXT_PUBLIC_MEDIA_URL`, default `NEXT_PUBLIC_API_URL/media`) and relaxes Next 16's private-IP guard
only when that host is `localhost`. A missing or broken image shows a neutral tile.

**Tests:** `npm test` (query/body validation, size ordering, guest token), and `npm run test:integration`
(`tests/integration/catalog.test.ts`: publication rule, filters, sorting, pagination, facets, private-field
leakage; `tests/integration/cart.test.ts`: server pricing, stock checks, ownership, merge, concurrency).

## 11. Known limitations

- **Category gaps:** essentially no leather or bomber jackets, trench coats, or Chelsea/combat boots exist in the source. Those categories are thin or absent and have not been filled with invented products.
- Prices and stock are synthetic (flagged). Real prices need merchandising input.
- One image per product (the dataset ships one). Gallery images exist only as retailer CDN URLs, which are deliberately not used.
- The source catalog is from the Indian market, mostly 2011–2013 (range 2007–2019), so some styling is dated.
- Source colour labels are kept even where the name disagrees (e.g. "ADIDAS Men Red T-shirt" is labelled Black), and some sizes are spelt inconsistently (`uk9`/`UK9`; matched case-insensitively). Each product has one colour, so the colour picker usually has one option.
- Searching for the brand's priority items that the source lacks ("leather jacket", "chelsea boots") returns weak or no matches; that is the category gap above, not a search fault.
- Checkout is not built (M6), so the bag ends at a subtotal.
- Two source listings (`24739` "Laser Cut Brown Handbag" and `24740` "Brown Casual Handbag", Murcia) ship the identical photo; both are imported as the source has them.
- 87 published products are sold out in every size (synthetic stock); they stay listed, labelled "Sold out", and can be hidden with the `inStock` filter.

## 12. Adding or updating products

There is no admin catalog UI or API yet (M3 remainder). Until there is:

- **Rerun the importer** to pick up source changes; §5 decides what it may touch. Use `--dry-run` first and read the report.
- **Copy edits** (name, description, brand) made directly in the database (e.g. `npm run prisma:studio`) are detected by the content hash and preserved by later imports.
- **Price, publication and category** changes made in the database are never overwritten by the importer. A product loses public visibility the moment it stops meeting the publication rule (ADR 0012) — no cache to clear.
- **Stock** must not be edited by hand: every stock change belongs with an `inventory_movements` row in the same transaction (database-design.md §4). The admin adjustment path is M4; until then, use only the importer's demo stock.
- **New products outside the dataset** need an image in storage first (key under `catalog/`), then a product, at least one priced `ACTIVE` variant and an image row, then `status = PUBLISHED` with `published_at`.

## 13. Phase 4 audit (2026-10-27)

**Database integrity** (read-only queries against the dev database). Every check below returned 0:
blank names/SKUs/alt text, malformed slugs, half-set provenance; duplicate slugs, SKUs, source ids,
option keys and object keys; orphan products, variants and images; images or SKUs not matching their
product's source id; categories nested deeper than two levels; non-positive prices, compare-at ≤ price,
negative stock; variants whose stock differs from the ledger sum or the last movement's balance;
published products without a priced active variant, an image, an active category or a publish date.

**Distribution** (published): Men 1,395 · Women 1,021 · Unisex 276.

| Group | Men | Women | Unisex |
|---|---|---|---|
| Outerwear — jackets 88, blazers 6 | 76 | 18 | 0 |
| Tops — t-shirts 300, shirts 248, knitwear 200 | 483 | 265 | 0 |
| Bottoms — trousers 250, jeans 96 | 246 | 100 | 0 |
| Dresses 74 | 0 | 74 | 0 |
| Footwear — sneakers 250, formal shoes 199, boots 16 | 298 | 92 | 75 |
| Accessories — sunglasses 250, wallets 200, belts 150, jewellery 48 | 267 | 292 | 89 |
| Bags — handbags 199, messenger 77, duffel 41 | 25 | 180 | 112 |

Colours (products): Black 1,270 · Brown 541 · Grey 370 · Navy Blue 284 · Olive 57 · Charcoal 50 ·
Maroon 47 · Silver 33 · Grey Melange 19 · Steel 14 · Coffee Brown 8 · Burgundy 3.
Variants: 9,381 (903 products have one variant, 814 have no size option; up to 13 sizes).
Stock: 919 variants sold out, 329 low, 8,133 healthy; 113,972 units. All prices `SYNTHETIC`, ৳900–৳14,250.
Images: 2,692 (one per product), JPEG, 1080–1800 px wide, average 324 KB; every file present on disk with the
recorded byte size; one duplicate photo pair (§11).

**Gaps, stated plainly:** boots 16 and blazers 6 are thin; no leather/bomber jackets, trench coats or
Chelsea/combat boots; women's outerwear 18; men's jewellery 2; no women's formal shoes; dresses has no parent group.

**Importer rerun on the dev catalog:** dry run then real run, both from cache — 44,446 rows examined, 0
inserted, 0 updated, 2,696 unchanged, 0 failed, 2,692 images already in storage, 21 s. A fingerprint of
every variant's SKU/price/stock/status/threshold and every product's slug/status/publish date/category/
content hash was identical before and after.

**Performance** (dev servers, median of 5): listing 16–39 ms (12 KB for 24 cards), page 100 29 ms, product
1.8 KB / 18 ms, categories 44 ms, facets 83–107 ms (cached 5 min per scope in the browser). `EXPLAIN
ANALYZE`: filtered listing 6 ms, two-word search with count 23 ms, offset 2,400 13 ms — existing indexes
suffice, so none were added. Product images reach the browser as WebP at the rendered width (a 384 px card
image is ~7 KB vs a 324 KB original); only the first row loads eagerly.

**Checks run:** backend format, lint, typecheck, build; `npm test` 146 passed; `npm run test:db` 71 passed;
`npm run test:integration` 122 passed; frontend format, lint, typecheck, production build. Browser walk-through
(desktop 1440 px and mobile 375 px): home → Men → Jackets → Boots → product → size UK7 → add to bag → bag shows
the database price; a sold-out variant (409), a draft product (404), an injected price (400) and quantity 11
(400) were refused from the browser. There is no Playwright suite in the repository, so this journey is not
automated end to end; the API half of it is covered by the integration suites.

## 14. The Dark Edit — featured front-runners (2026-10-29)

A hand-written **synthetic** set of 40 dark-fashion pieces that every listing shows first
([ADR 0013](decisions/0013-featured-dark-edit.md)). The Kaggle catalog stays as it is and follows them.

| | |
|---|---|
| Dataset | `backend/scripts/catalog-import/curated/dark-edit.json` — id, rank, name, category, gender, colour, size set, description, photo credit |
| Content | Jackets 12 (leather ×7, bomber ×4, denim, puffer) · blazers 6 · coats 5 · hoodies 7 · boots 7 · knitwear 2 · cargo trousers 1 |
| Synthetic | Names, copy, sizes and the `EVORA` brand are invented; price and stock are `SYNTHETIC` (BDT bands; `coats` ৳9,500–18,500 and `hoodies` ৳2,800–5,800 added) |
| Photos | Unsplash photos under the Unsplash License, fetched only from `images.unsplash.com` at 1600 px, cached in `.data/catalog/dark-edit/images/`, validated by bytes, stored at `catalog/commercecore-dark-edit/<id>/1.jpg`; photographer and photo page recorded on each image row |
| Provenance | `source_provider = 'commercecore-dark-edit'`, external id `DE001`–`DE040`, SKU `EV-DE0nn-<size>` |
| Order | `featured_rank` 1–40; `GET /products` defaults to `sort=featured` (rank, then newest). The home page's "The Dark Edit" section shows the first eight |

```bash
cd backend
npm run catalog:dark-edit -- --dry-run --publish   # rehearse; writes nothing (photos are still cached)
npm run catalog:dark-edit -- --publish             # real import; rerunning changes nothing
```

The importer reuses `persistProduct`, so §5's rerun rules hold, plus: **`featured_rank` is written on create
only** — editing `rank` in the JSON does not move a product that is already imported. Rollback is §7 with
`source_provider = 'commercecore-dark-edit'` and `backend/.data/media/catalog/commercecore-dark-edit/`.

**First import (2026-10-29):** 40 inserted and published, 214 variants, 197 stock movements, 40 images; new
categories `coats` and `hoodies`. Rerun: 40 unchanged. Database checks: ranks 1–40 unique, no other product
ranked, stock equals ledger sum for every Dark Edit variant.

Known limits: one photo per product; several photos are styled shots (a model, a street) rather than
packshots; item DE026 is dark brown leather and is labelled `Coffee Brown`, not black.
