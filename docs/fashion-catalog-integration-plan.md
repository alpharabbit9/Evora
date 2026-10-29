# Fashion Catalog Integration — Phase 1 Findings and Plan

- **Status:** Accepted 2026-10-27 — Phases 2–4 done (audit results: `fashion-catalog-setup.md` §13). Decisions are recorded in §9.1.
- **Date:** 2026-10-27
- **Scope of Phase 1:** audit and research only. No schema, backend, frontend or data was changed.
- **Relationship to the roadmap:** this work *is* milestone M3 ("Catalog and seed import",
  `docs/implementation-plan.md`), narrowed to a fashion catalog. Its done-criteria apply:
  runtime catalog comes from our own DB, an import rerun does not overwrite stock/prices,
  unpublished products stay private.

---

## 1. Existing architecture (verified from source)

| Area | What exists | Evidence |
|---|---|---|
| Layout | Two deployables: `frontend/` (Next.js) and `backend/` (Express API). Not a single Next.js app. | ADR 0006, `README.md` |
| Frontend | Next.js **16.4.2**, React 19.3, Tailwind 4, shadcn/ui on `@base-ui/react`, TanStack Query 5, Framer Motion + GSAP, `cacheComponents: true`. App Router with a `(store)` route group. | `frontend/package.json`, `next.config.ts` |
| Frontend pages | Home (hero, why-shop, sample reviews, newsletter, FAQ), `/account`, `/auth`. **No product listing, product detail, collection or cart pages.** | `frontend/src/app/**` |
| Product data in frontend | **None** — no hardcoded product arrays and no mock product API. Header links `/collections/men`, `/collections/women`, `/collections/kids`, `/collections/beauty`, `/collections/new` all 404 today. | `components/layout/site-header.tsx` |
| API client | `apiFetch` / `apiGet` in `src/lib/api-client.ts`: unwraps `{data, meta}`, raises `ApiError`, `cache: 'no-store'` by default, base `NEXT_PUBLIC_API_URL + /api/v1`. | `src/lib/api-client.ts`, `src/lib/env.ts` |
| `next/image` | No `images.remotePatterns` configured, so remote product images would be rejected until configured. | `next.config.ts` |
| Backend | Express 5, Better Auth 1.7 (cookie sessions), Zod 4, Pino, Helmet, rate limiting, Origin check on state changes. Modules: `identity`, `admin`, `orders` (read-only), `audit`, `notifications`. **No catalog module and no public product routes.** | `backend/src/**`, `http/routes/index.ts` |
| Route conventions | `route({ query, params, body, handler })` adapter validates input and wraps the envelope; `paged()` for collections; shared `paginationQuery` (page ≥1, pageSize ≤100), `sortQuery` (allow-listed enum), `opaqueId`, slug schema in `http/schemas.ts`. | `http/route.ts`, `http/schemas.ts` |
| Database | PostgreSQL + Prisma **7.10** with `@prisma/adapter-pg`. 6 migrations applied on the dev DB. 76 hand-written CHECKs + 3 partial unique indexes live in migration SQL — **never `prisma db push`**. | `prisma/schema.prisma`, `docs/database-design.md` §10 |
| Dev DB state | `categories` 0, `products` 0, `product_variants` 0, `product_images` 0, `orders` 0, `users` 1 (read-only count, 2026-10-27). The dev seed has not been run. | queried |
| Seed | `prisma/seed.ts` + `seed-data.ts`: 4 generic categories (apparel/t-shirts/accessories/audio), 6 generic products. Establishes the **rerun rule**: price, stock, threshold, publication and variant status are written on create only; reruns refresh descriptive copy. Its header says "the DummyJSON sample import (PRD FR-08) is a separate M3 script". | `prisma/seed.ts` |
| Object storage | `@aws-sdk/client-s3` and the presigner are installed and `S3_*` env vars are declared, but **no code uses them, no values are set, and the provider is undecided**. Docker is installed but its daemon was not running. | `package.json`, `config/env.ts`, `.env` (keys only) |
| Money | Integer minor units (`priceMinor Int`), **one store currency, not yet chosen** (ADR 0008, PRD §9). Currency is stored on Order/Payment/Refund only — not on catalog rows. | ADR 0008 |
| Cart / checkout / inventory | Tables exist; **no behaviour**. Cart is M5, checkout M6, inventory write path M4. ADR 0004 (decrement vs reservation) is still **Proposed**. | `implementation-plan.md`, ADR 0004 |

### 1.1 Catalog schema as it stands

```text
Category        id, name, slug (unique, kebab CHECK), description, parentId (self FK), isActive, sortOrder
Product         id, name, slug (unique, kebab CHECK), description, brand, categoryId, status DRAFT|PUBLISHED|ARCHIVED, publishedAt
                CHECK status <> PUBLISHED OR published_at IS NOT NULL
ProductVariant  id, productId, sku (unique), optionKey (unique per product), options Json, priceMinor, compareAtPriceMinor,
                stockQuantity, lowStockThreshold, weightGrams, status ACTIVE|INACTIVE|ARCHIVED
                CHECK price >= 0, stock >= 0, ...
ProductImage    id, productId, variantId?, objectKey (unique, NOT a URL), altText (required, non-blank), sortOrder,
                widthPx, heightPx, byteSize, contentType
```

Fields the integration needs that **do not exist**: gender/department, source provider + external id
(dedup key), source URL / image attribution / licence, and price provenance (source vs synthetic vs
manual). See §6.

### 1.2 Code/doc conflicts surfaced (not silently resolved)

1. **PRD FR-08 names DummyJSON** as the sample import; this plan recommends a different source (§3).
   PRD FR-08 and the `seed-data.ts` header need updating if approved.
2. **Phase 3 of the brief asks for add-to-cart and server-validated checkout**, but cart (M5) and
   checkout (M6) do not exist and ADR 0004 is unresolved. Wiring "add to cart" means building M5,
   which is a milestone of its own. See decision D7.
3. **Header navigation offers Kids and Beauty**; the brand direction is men/women dark fashion.
   Changing nav is a merchandising decision (D9).
4. The **existing dev seed** (headphones, steel bottle, tote) is off-brand. Running it next to the
   fashion import would put audio gear in the catalog (D8).
5. `ProductImage.objectKey` is unique and assumes our own object storage; storing third-party URLs
   in it would break that contract (§7).

---

## 2. Candidate sources — what was actually verified

Verification method: live API/CDN calls and direct downloads into a scratch directory on 2026-10-27,
not documentation alone. "Unverified" means I could not inspect it without an account.

| | **A. Fashion Product Images** (Kaggle, `paramaggarwal`) | **B. ASOS e-commerce dataset** (Hugging Face, `UniqueData`) | **C. DummyJSON** | **D. H&M Personalized Fashion Recs** (Kaggle competition) |
|---|---|---|---|---|
| Records | **44,446** styles (`styles.csv`, verified). Small version mirror on HF: 44,072 rows. | **30,845** rows, 29,972 unique SKUs (CSV downloaded, verified) | **49** products across 10 fashion categories (live API, verified) | ~105k articles (reported; not downloaded) |
| Men / Women | Men 22,104 · Women 18,357 · Unisex 2,126 · Boys 830 · Girls 655 (verified) | No gender field; inferable from category/URL only | Category slug (`mens-*`, `womens-*`) | `index_group_name` (reported) |
| Fields (verified) | id, gender, masterCategory, subCategory, articleType (141 values), baseColour (46), season, year, usage, productDisplayName | url, name, size, category, price, color, sku, description (JSON-ish string, includes brand/composition), images (list) | title, description, category, price, discount, rating, stock, brand, sku, weight, images, thumbnail | article metadata, colour group, department (reported) |
| Brand | Not a column; is the first token(s) of `productDisplayName` (Nike, Puma, Adidas, Roadster…) — needs a parse rule | Inside `description` | Yes (incl. Rolex, Prada, Nike) | No |
| Price | **None in `styles.csv`.** Full version's `styles/{id}.json` is *reported* to carry price/brand/description/sizes (likely INR) — **unverified, Kaggle login required** | Yes, **currency not stated** (UK sizes suggest GBP; not provable from data) | Yes, currency not stated | Only scaled transaction prices |
| Sizes | Not in CSV; *reported* in full JSON — unverified | Yes (`UK 4, …, UK 14 - Out of stock`) | No | No |
| Images | Small: 60×80 px (verified) — unusable for a storefront. Full: high-res, 15.7 GB total (Kaggle metadata, verified) | Remote ASOS CDN URLs | Remote DummyJSON CDN URLs | Bundled images (reported) |
| Data quality | Clean, consistent labels | **Row misalignment observed:** row 1's URL is a Stradivarius biker jacket, its name/images a New Look trench coat | Small, playful (party glasses, "Gigabyte Aorus Men Tshirt") | — |
| **Licence (as stated)** | Kaggle licence field: **MIT** (verified via Kaggle API) | **CC BY-NC-ND 4.0** (verified on HF card); commercial use "buy from vendor" | Repo code MIT; **no terms stated for the data/images** | Competition data, **non-commercial / research** (secondary source) |
| Underlying rights | Uploader describes the data as scraped e-commerce listings (Myntra). Product photos and brand names belong to Myntra/the brands; an uploader's MIT label **cannot grant rights the uploader doesn't hold**. | ASOS owns its photos; NC forbids commercial use; ND forbids distributing adapted versions | Brand names include trademarks | H&M owns images |
| Access | Free Kaggle account + API token; individual files downloadable | Public CSV | Public API, no auth | Kaggle account + accept rules |

### 2.1 Dark-fashion coverage (verified counts from `styles.csv`)

Dark = Black, Charcoal, Grey, Navy, Brown and similar. This is what the brand direction can actually
draw from source A:

| Brand priority | Source A count (men / women) | Verdict |
|---|---|---|
| Leather jackets | **0** (no "leather" + "jacket" names) | **Gap** |
| Bomber jackets | **0** | **Gap** |
| Trench / overcoats | **1** | **Gap** |
| Dark jackets (any) | 156 (131 / 23) | OK |
| Black T-shirts | 1,049 (861 / 136) | Strong |
| Dark shirts | 504 (430 / 53) | Strong |
| Dark knitwear / sweatshirts | 317 (251 / 65) | OK |
| Turtle / high necks | 38 | Thin |
| Black jeans | 78 (30 / 40); dark/blue denim 594 | OK |
| Dark trousers | 402 (333 / 66) | Strong |
| Cargo pants | 19 | Thin |
| Boots (Chelsea / combat / dress) | **45 total** by name | **Gap** |
| Formal shoes black/brown | 617 (all men) | Strong (men only) |
| Black casual shoes / sneakers | 875 (716 / 88) | Strong |
| Sunglasses (dark frames) | 716 (371 / 232) | Strong |
| Wallets black/brown | 592 (425 / 148) | Strong |
| Belts black/brown | 575 (457 / 111) | Strong |
| Rings / chains (dark metal) | 184 (42 / 142) | OK |
| Messenger / duffel / laptop bags | 214 | OK |
| Black handbags / clutches | 427 (women) | Strong |

Source B has what A lacks (leather/biker 252, bomber 167, trench 236, Chelsea 34 by name) but no
sunglasses or wallets — and its licence rules it out (§3).

---

## 3. Selection and justification

**Recommended primary source: A — Fashion Product Images (full, high-res), imported as a curated
dark-fashion subset.**

Why:
- Largest *usable* structured catalog with real gender, category and colour attributes, which is
  exactly what the filters need. Strongest coverage of accessories, footwear, trousers and tops.
- The only candidate whose stated licence is not non-commercial (MIT on Kaggle).
- Stable integer ids make a clean idempotency key.

Why not the others:
- **B (ASOS)** — CC BY-NC-ND forbids commercial use and adapted redistribution; images are ASOS
  property; observed row misalignment means names/images may not match. Excluded.
- **C (DummyJSON)** — 49 fashion items, none in the priority categories (no leather jackets,
  boots, trench coats), real luxury trademarks at invented prices. Not worth a pipeline; the
  existing seed already covers "small fixture".
- **D (H&M)** — non-commercial competition data, no usable prices. Excluded.

**The licence caveat, stated plainly:** the MIT label is the uploader's. The product photos and
brand names originate from a retailer and its brands, and nothing I found grants commercial rights
to them. That makes source A appropriate for **local development and a clearly-labelled,
non-commercial demo**, and **not appropriate as the catalog of a real store or a public deployment
that presents these products as for sale**. A production catalog needs rights-cleared data: the
store's own products and photography, or a supplier/dropship catalog whose terms grant resellers
image rights. This plan keeps the pipeline source-agnostic (§5) so that swap is a new adapter, not a
rewrite. → Decision D1.

**Category gaps** (leather/bomber jackets, trench coats, Chelsea/combat boots) are **documented, not
filled with invented products**. Options to close them later: own/commissioned photography, a
licensed supplier feed, or hand-authored house products with properly licensed imagery. → D6.

---

## 4. Source-to-database mapping

Source A row → CommerceCore:

| Source field | Destination | Rule |
|---|---|---|
| `id` | `Product.sourceExternalId` (new) with `sourceProvider = 'fashion-product-images'` (new) | Unique pair = idempotency key |
| `productDisplayName` | `Product.name` | Trim, collapse whitespace; reject if blank |
| `productDisplayName` + `id` | `Product.slug` | `kebab(name)-{id}` — the id suffix guarantees uniqueness and satisfies the slug CHECK |
| Full JSON description (if verified) | `Product.description` | Strip HTML to plain text; else `null` — **never generated copy** |
| Brand (full JSON `brandName` if present; else parsed prefix from a curated brand list) | `Product.brand` | Unknown → `null`, not guessed |
| `gender` | `Product.gender` (new enum) | Men→`MEN`, Women→`WOMEN`, Unisex→`UNISEX`; **Boys/Girls excluded** (no kids line) |
| `masterCategory`/`subCategory`/`articleType` | `Category` via an explicit mapping table in code | Unmapped articleTypes are excluded and counted in the report |
| `baseColour` | variant `options.color` | Normalised to a fixed palette; the source value is kept, never recoloured to "black" |
| `season`, `year`, `usage` | Not stored (no destination); may drive inclusion rules (e.g. drop `Ethnic`) | — |
| Sizes (full JSON, if verified) | One `ProductVariant` per real size, `optionKey = color:x|size:y` | If sizes are unknown: **one variant**, `optionKey = color:x`, no size claimed |
| — | `ProductVariant.sku` | `FPI-{id}` or `FPI-{id}-{SIZE}`; prefix avoids collision with seed SKUs |
| Price (full JSON, if verified) | `priceMinor` + `priceSource = SOURCE` | Only after an explicit, documented INR→store-currency rule; otherwise not used |
| — (no trusted price) | `priceMinor` + `priceSource = SYNTHETIC` | Only if D3 approves demo pricing; else product stays `DRAFT` |
| Image | `ProductImage` (`objectKey`, `altText`, `widthPx`, `heightPx`, `byteSize`, `contentType`, new `sourceUrl`/`attribution`) | `altText` = product name + colour (non-blank CHECK) |
| — | `Product.status` | Always created `DRAFT`; publishing is a separate, explicit step (§5.4) |

### 4.1 Proposed category tree (gender is a column, not a branch)

```text
outerwear     → jackets, blazers, coats (empty until gap filled)
tops          → t-shirts, shirts, knitwear
bottoms       → jeans, trousers
footwear      → boots, formal-shoes, sneakers
accessories   → sunglasses, wallets, belts, jewellery, watches (D5)
bags          → handbags, messenger-bags, duffel-bags
```

Gender as a column (not `men/…` and `women/…` subtrees) avoids duplicating every category and makes
"Men + Footwear" a simple indexed filter.

### 4.2 Expected volume

Summing the dark subsets in §2.1 gives roughly **6,300 candidates** (≈7,300 including black
watches). Recommended: **cap at ~3,000 products** with per-category ceilings so the catalog stays
curated rather than 1,000 near-identical black tees. Estimated images: 3,000 primaries (+ up to 3
gallery images each if the full JSON exposes them). At high-res originals (~300–600 KB) that is
roughly 1–2 GB raw, ~200–400 MB after WebP derivatives. Variants: 3,000 if sizes are unknown;
≈12–15k if sizes are verified (estimate).

---

## 5. Pipeline design (Phase 2)

Location: `backend/scripts/catalog-import/` (TypeScript, run with `tsx`, uses the existing Prisma
client and logger). Exposed as `npm run catalog:import -- [flags]`.

```text
acquire  → raw files in backend/.data/catalog/<source>/  (gitignored; never in frontend source)
parse    → typed SourceRecord[]            (adapter per source: one file per provider)
validate → Zod schema per record           (invalid → report, not crash)
normalise→ names, colours, gender, brand, category mapping
filter   → dark-fashion inclusion rules + per-category caps
dedupe   → by (provider, externalId); then near-duplicate names within a category
images   → download, verify (MIME sniff, dimensions, size cap), derive WebP, upload to storage
persist  → upsert per product in a short transaction (product + variants + images)
report   → JSON + console summary
```

Acquisition and persistence are separate stages: `--stage=acquire` can run without a database, and
`persist` reads only local files, so a network failure never leaves a half-written transaction.

### 5.1 Flags
`--dry-run` (everything except DB and storage writes; still produces the report) ·
`--limit=N` · `--category=…` · `--stage=acquire|images|persist|all` · `--publish` (see §5.4) ·
`--demo-pricing` / `--demo-stock` (only if D3/D4 approve).

### 5.2 Idempotency and rerun rules (extending the seed's rule)
- Key: unique `(sourceProvider, sourceExternalId)` constraint; SKU unique as a second guard.
- **Created once, never rewritten by a rerun:** `priceMinor`, `compareAtPriceMinor`, `stockQuantity`,
  `lowStockThreshold`, variant `status`, product `status`/`publishedAt`, `categoryId`.
- **Refreshed on rerun:** name, description, brand, image metadata — **unless locally edited**.
  Detection: store `sourceContentHash` of the descriptive fields the importer last wrote; if the
  row's current fields no longer hash to it, an admin changed them → skip and report
  `skipped_local_override`.
- A product missing from a later source run is **not deleted or archived**; it is reported as
  `not_seen_this_run`.
- Per-product transactions: one bad record rolls back only itself. No network call inside a
  transaction (images are uploaded before the DB write; an orphaned object on failure is
  harmless and is listed in the report).

### 5.3 Report
Counts of examined / included / excluded (by reason) / invalid / inserted / updated / unchanged /
skipped_local_override / failed / not_seen_this_run, plus distribution by gender, category, colour,
variant count, image count and failed image ids. Written to `backend/.data/catalog/reports/<timestamp>.json`.

### 5.4 Publication rule
A product becomes visible only when **all** hold: `status = PUBLISHED`, at least one `ACTIVE`
variant with a valid price, at least one image, and an active category. The importer creates
everything as `DRAFT`; `--publish` promotes only records that pass the rule. The public API applies
the same rule in its query, so a draft can never leak even if a flag is misused.

### 5.5 Money, stock and provenance
- No currency is assumed. Source prices are used only through an explicit, documented conversion
  rule (D2). Otherwise prices are either synthetic (D3) or absent (product stays `DRAFT`).
- Synthetic prices are deterministic per product (hash of source id within a per-category band),
  carry `priceSource = SYNTHETIC`, and the storefront can label them "demo price".
- Source A has **no stock data**. Default: variants created with `stockQuantity = 0` (not
  purchasable). With `--demo-stock`, synthetic stock is set at creation and an
  `InventoryMovement` (`IMPORT_CORRECTION`, system) is written in the same transaction, so the
  ledger reconciles from day one (D4).

---

## 6. Proposed schema change (one migration, Phase 2)

Smallest change that represents what the brief requires; nothing else is altered.

```prisma
enum ProductGender { MEN WOMEN UNISEX }
enum PriceSource   { MANUAL SOURCE SYNTHETIC }

model Product {
  // ...existing fields
  gender            ProductGender?  // null = not applicable / unknown
  sourceProvider    String?         @map("source_provider")
  sourceExternalId  String?         @map("source_external_id")
  sourceUrl         String?         @map("source_url")
  sourceContentHash String?         @map("source_content_hash")
  @@unique([sourceProvider, sourceExternalId])
  @@index([gender, status])
}

model ProductVariant {
  // ...existing fields
  priceSource PriceSource @default(MANUAL) @map("price_source")
}

model ProductImage {
  // ...existing fields
  sourceUrl   String? @map("source_url")
  attribution String?
}
```

Hand-written SQL in the same migration:
- CHECK `source_provider` and `source_external_id` are both null or both non-blank.
- GIN index on `product_variants.options` (jsonb) for colour/size filters — only if `EXPLAIN` on
  the Phase 3 queries shows it is used.
- `tests/db/constraints.test.ts` extended to assert the new CHECK exists.

Admin-visible only: `sourceUrl`, `sourceContentHash`, `attribution`, `priceSource` are **never** in
public API responses (attribution may be rendered if a licence requires it).

---

## 7. Image hosting strategy

`ProductImage.objectKey` is a storage key, so images must live in object storage we control.

- **Recommended:** S3-compatible storage through the already-installed `@aws-sdk/client-s3` and the
  declared `S3_*` env vars. Locally: **MinIO in Docker** (Docker is installed; the daemon must be
  started). Later environments: R2/S3 — a config change, not code. No new provider dependency.
- **Fallback if Docker is unwanted:** a small `storage` module with two drivers — `s3` and
  `filesystem` (dev-only, served by the backend under `/media`), selected by env.
- Pipeline: download original → sniff MIME (JPEG/PNG/WebP only) → reject > 10 MB or < 300 px →
  upload the original unchanged as `catalog/<provider>/<externalId>/1.<ext>` → record
  dimensions/bytes. *(As built: WebP derivatives were dropped. `next/image` already produces
  responsive WebP at request time, and generating them would have meant adding a native image
  library to the backend.)*
- Missing or failed images: product is imported but fails the publication rule; frontend uses a
  neutral fallback tile for any image that fails to load.
- Frontend: add the storage origin to `images.remotePatterns`; use `next/image` with `sizes` and
  lazy loading.
- Hot-linking the retailer's CDN is **not** proposed: those URLs are unstable and serving them
  directly is precisely the redistribution the licence question is about.

---

## 8. Validation, update and rollback

**Validation (Phase 2/4):** DB integrity queries (orphans, unique slugs/SKUs, published-without-price,
published-without-image = 0), distribution report, rerun produces 0 inserts and 0 operational-field
changes, `tests/db` suite for the importer (first run, rerun, dry run, duplicate source rows, missing
fields, bad image, local override preserved, partial failure).

**Update:** rerun the importer; the rules in §5.2 decide what changes.

**Rollback:**
- Schema: the migration is additive (nullable columns, new enums, one unique, one CHECK). Forward-fix
  preferred; a down-migration SQL file will be written and reviewed but not auto-applied.
- Data: every imported row is identifiable by `source_provider`. A rollback script deletes
  imported products **only if no `order_items`/`cart_items` reference their variants** (none can
  today), otherwise archives them. Storage objects are under one prefix and can be removed together.
  Running it requires explicit authorisation (CLAUDE.md).
- Dev first, always. Nothing touches any non-dev database without explicit approval.

---

## 9. Decisions needed before Phase 2

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | Accept source A under its licence limits? | (a) Dev/non-commercial demo only, labelled as such · (b) Seek rights-cleared data first (own catalog / supplier feed) | **(a)**, with the storefront marked demo and no public deployment presenting these as for sale |
| **D2** | **Store currency** (ADR 0008, PRD §9) | BDT · USD · other | Your call — required before any price exists |
| **D3** | Pricing when the source has none (or before D2's conversion rule) | (a) Deterministic synthetic prices flagged `SYNTHETIC` + "demo price" label · (b) Import as `DRAFT` without prices | (a) for a browsable demo |
| **D4** | Stock | (a) 0 (unpurchasable) · (b) synthetic demo stock with ledger entry | (b) if Phase 3 should demo add-to-cart |
| **D5** | Include watches? (987 black watches; not in the brief's list) | include / exclude | Exclude — off-brief, would dominate accessories |
| **D6** | Category gaps (leather/bomber, trench, Chelsea/combat boots) | Document and leave empty · add later from a licensed source | Document now; fill later |
| **D7** | Phase 3 cart scope | (a) Catalog API + PLP/PDP + variant selection; add-to-cart deferred to M5 · (b) also build M5 cart (bigger; needs guest-token design) | (a); add-to-cart button disabled with an honest "coming soon" is *not* acceptable per CLAUDE.md, so the button is omitted until M5 |
| **D8** | Existing generic dev seed | keep · replace with on-brand fixtures · leave seed un-run | Replace its catalog fixtures with a few on-brand ones so tests keep a tiny deterministic catalog |
| **D9** | Header Kids / Beauty links | remove · keep | Remove (no catalog behind them) |
| **D10** | Storage | MinIO (Docker) · filesystem dev driver | MinIO |
| **D11** | Kaggle access | You create a Kaggle API token and put it in `backend/.env` (`KAGGLE_USERNAME`, `KAGGLE_KEY`, never committed) · you download the archive manually | Token; the importer downloads only the files it needs instead of 15.7 GB |

### 9.1 Decisions taken (2026-10-27)

| # | Outcome | Who |
|---|---|---|
| D1 | Source A accepted as a **development / non-commercial demo** catalog (recommendation) | default, project owner did not object |
| D2 | **Store currency: BDT** (minor unit: poisha, exponent 2). Recorded in ADR 0008. | project owner |
| D3 | **Synthetic prices**, deterministic per product, flagged `SYNTHETIC`. Source prices (if any) are **not** converted. | project owner |
| D4 | **Synthetic demo stock**, written with an `IMPORT_CORRECTION` inventory movement | project owner |
| D5 | Watches excluded | default |
| D6 | Gaps documented, not filled | default |
| D7 | Phase 3 = catalog API + PLP/PDP + variant selection; cart stays M5 | default (revisit at Phase 3) |
| D7 (revisited) | The Phase 3 brief requires add-to-cart with server-validated price and stock, so the **cart core** (account + guest cart, merge, validation) was built. Checkout remains M6 (ADR 0004 open). See ADR 0012. | Phase 3, 2026-10-27 |
| D8 | Generic dev seed left as is for now; importer coexists with it | default (revisit at Phase 3) |
| D9 | Kids and Beauty removed from header and footer; replaced by Accessories and Shop all | Phase 3, 2026-10-27 |
| D10 | Storage module with a `filesystem` dev driver (Docker daemon not running) and an `s3` driver for MinIO/R2/S3 | default |
| D11 | Project owner supplies a Kaggle API token in `backend/.env` | project owner |

### 9.2 Verified during Phase 2 (2026-10-27)

- `styles/<id>.json` → `data` has `brandName`, `productDescriptors.*.value` (HTML), `styleOptions[]`
  (`name: "Size"`), `ageGroup` (`Adults-Men`, `Kids-Girls`, …), `landingPageUrl`, `price` and
  `discountedPrice`. **There is no currency field**, so the source price is not used. Gallery images
  appear only as retailer CDN URLs. The dataset ships one JPEG per style.
- Kaggle's file-download API needs the file path URL-encoded as one segment (`a%2Fb`).
- `styles.csv` is not RFC 4180: a literal inch mark (`3.5"`) in two names made a quote-aware reader
  swallow ~2,000 rows. It is now parsed as unquoted CSV, and a regression test covers it.
- Kaggle wraps some served files in ZIP even when you request a single file: `styles.csv` always, and images
  over ~900 KB (21 of 2,695). It also writes sizes in the ZIP64 extra field of an otherwise ordinary archive.
  The importer unwraps these when reading the cache.
- Kaggle rate-limits bursts (HTTP 429 after ~600 requests). The client pauses all workers, honours
  `Retry-After`, and retries; the default concurrency is 2.
- The first version of `products_source_identity_check` let a half-set identity through, because
  `NULL > 0` is NULL and a CHECK accepts NULL. The DB test caught it and migration
  `20261027120100_fix_source_identity_check` corrects it.

## 10. Risks and unknowns

- ~~Unverified until Kaggle access~~ — resolved, see §9.2.
- Licensing (§3) is the largest risk; this is an engineering assessment, not legal advice.
- Brand names are real trademarks; shown as source facts, never as endorsements.
- Brand parsing from display names is heuristic; unknown brands become `null`, not guesses.
- Colour labels are the source's; some "Black" items may photograph as charcoal. We do not
  relabel.
- 2011–2013-era Indian-market catalog: styling may not fully match a premium Western dark-fashion
  look; curation caps and exclusion of `Ethnic` usage mitigate this.
- Int minor-unit ceiling is irrelevant at these price levels.

## 11. Sources

- Kaggle API metadata: `paramaggarwal/fashion-product-images-small` and `…/fashion-product-images-dataset` (licence MIT, 15.7 GB)
- `styles.csv` (44,446 rows) via Hugging Face mirror `sngdmtdkw-02/fashion-product-images`; small-image stats via `ashraq/fashion-product-images-small`
- https://huggingface.co/datasets/UniqueData/asos-e-commerce-dataset (CC BY-NC-ND 4.0; CSV downloaded)
- https://dummyjson.com/products/categories and `/products/category/*`
- https://relbench.stanford.edu/datasets/rel-hm (H&M licence, secondary)
- https://help.unsplash.com/articles/2612317-can-i-use-unsplash-photos-as-part-of-a-product-to-sell (possible gap-filling imagery)
