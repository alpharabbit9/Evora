# CommerceCore — Implementation Plan

Implement one end-to-end milestone at a time. Dates omitted; sequence follows dependencies and risk. Do not mark a UI-only feature complete.

## M0 — Repository and decisions
Inspect repository/framework/package manager; confirm auth, payment provider, deployment and environment strategy. Add env validation, `.env.example`, lint/type-check/test/build CI and initial ADRs.
**Done when:** clean clone setup works, no secrets are committed, CI commands run.

## M1 — Foundation
App shell, responsive layouts, shared UI/error/loading/empty patterns, PostgreSQL/Prisma, migration workflow, safe error responses and structured logging.
**Done when:** clean database migration and reproducible dev setup work; CI build passes.

## M2 — Identity and authorization — **implemented**
Registration/login/logout/reset via maintained auth tooling, role/status, protected account/admin, rate limits.
**Tests:** unauthenticated requests fail; non-admin direct API denied; cross-user address/order access denied; reset flow avoids account enumeration.

Delivered per [ADR 0009](decisions/0009-identity-authorization-and-rate-limiting.md): Better Auth
email/password, `CUSTOMER < ADMIN < SUPERADMIN`, `/me` profile + addresses + sessions,
own-order reads, admin customer status/role with audit, layered rate limits, and an Origin
check on every cookie-authenticated state change. Verified by 95 unit, 52 database and 80
HTTP integration tests.

**Carried forward:** password-reset and verification links are queued in `outbox_events`; the M9
worker sends them (ADR 0021), but no email provider is chosen (PRD §9), so
`requireEmailVerification` stays `false`. Cart ownership (M5), product and
inventory authorization (M3/M4) and order transitions (M8) are not built.

## M3 — Catalog and seed import
Category/product/variant/image schema; repeatable sample import; public search/filter/sort/pagination; admin catalog CRUD/archive; object storage.
**Done when:** runtime catalog comes from own DB; import rerun does not overwrite operational stock/prices; unpublished products remain private.

**Implemented.** Done: the repeatable fashion catalog importer (`backend/scripts/catalog-import/`,
[ADR 0011](decisions/0011-catalog-import-provenance.md), `docs/fashion-catalog-setup.md`), the
provenance/gender/price-source migration, and an object-storage module with filesystem (dev) and
S3 drivers. Store currency is BDT (ADR 0008 amendment). Phase 3 added the public catalog API
(`/products`, `/products/facets`, `/products/:slug`, `/categories`), dev media serving at `/media`,
and the storefront listing (`/shop`, `/collections/{men,women,new}`, `/search`), product
(`/products/[slug]`) and bag (`/cart`) pages — [ADR 0012](decisions/0012-public-catalog-api-and-cart-ownership.md).
Phase 4 added admin catalog CRUD: product list/create/update/archive, variant create/update,
image create/update/delete, and category list/get/create/update — all behind `requireAdmin`,
with audit rows on every write. 36 integration tests in `tests/integration/admin-catalog.test.ts`.
Not done: admin image file upload (metadata-only for now; file upload endpoint is a follow-up),
object storage admin dashboard.

## M4 — Inventory — **implemented**
Stock per variant, movements, low-stock thresholds, admin adjustment + reason/audit. Decide decrement-on-order vs timed reservation in ADR.
**Tests:** concurrent final-unit purchase never oversells; every adjustment has a movement record.

**Delivered per [ADR 0004](decisions/0004-inventory-policy.md):** atomic decrement-on-order
policy (no timed reservations for v1). Admin inventory listing with low-stock filter,
variant stock detail with recent movements, stock adjustment with conditional atomic write
(architecture.md §8), movement history, and low-stock outbox alerts. Checkout (M6) calls the
concurrency-safe `claimStock`; `releaseStock` waits for cancellation (M8). 22 integration tests in `tests/integration/inventory.test.ts` including
a concurrent final-unit race test that proves stock never goes negative.

## M5 — Cart and pricing
Persistent account cart, secure guest cart, merge behavior, quantity/coupon preview and shared server pricing.

**Partly implemented** with the fashion catalog Phase 3 (ADR 0012): account carts, ownership,
merge, server-side price/stock validation and line status. Since ADR 0014 the cart is signed-in
only (no new guest carts; pre-existing ones still merge on sign-in), and the customer wishlist
(ADR 0016) is built on the same patterns. The shared pricing module arrived with M6, and checkout
refuses an order whose total changed after the customer saw it. The bag says when a line's price has
moved since it was added (`cart_items.unit_price_seen_minor`, display only). Coupons arrived with M10,
entered at checkout rather than on the cart.
**Done when:** ownership/token is checked, client totals are not authoritative, changed prices/stock are surfaced.

## M6 — Checkout and orders — **implemented**
Quote/create flow, shipping/contact snapshots, order/item snapshots, idempotency key/fingerprint, COD state, durable outbox event.
**Tests:** repeated same request returns prior result; same key/different payload conflicts; required writes roll back; catalog edits do not rewrite historical order.

Delivered per [ADR 0018](decisions/0018-checkout-orders-and-provisional-delivery.md):
`POST /checkout/quote` and `POST /checkout` (signed-in, COD only), the shared pricing module
(`modules/pricing`), one transaction for order, snapshots, stock claim, movements, payment row,
status history, receipt outbox event and low-stock alert, and the `/checkout` and
`/orders/[orderId]` pages, with an order list on `/account`. 44 integration tests in
`tests/integration/checkout.test.ts` (including final-unit and duplicate-request races) and 7 unit
tests in `tests/pricing.test.ts`.

**Provisional:** delivery fees, the Dhaka/national zones, Bangladesh-only delivery and zero tax are
development defaults, because PRD §9 has not decided them. **Carried forward:** online payment (M7);
order tracking, cancellation and releasing stock on cancel (M8); delivering the queued receipt (M9);
coupons (done in M10). An automated browser test of this flow does not exist yet (M11). The address book
is on `/account`, which also edits the name, changes the password and lists/revokes sessions;
`/forgot-password` and `/reset-password` drive Better Auth's reset (links are only queued until M9).

## M7 — Sandbox payments/webhooks — **implemented; not yet verified against the real sandbox**
Select provider, adapter, signed webhook verification, deduplication, state machine, retry/reconciliation.
**Tests:** invalid signature rejected; duplicate/out-of-order event safe; browser closure after payment recoverable; provider timeout creates recoverable state.

Delivered per [ADR 0019](decisions/0019-online-payments-sslcommerz.md): SSLCOMMERZ, with bKash, cards
and mobile banking on its hosted page. `modules/payments` holds the provider interface and adapter, a
pure state machine (`payment-state.ts`), `POST /orders/:orderId/payment-session`,
`POST /webhooks/payments/:provider`, the browser return, `GET /payments/:paymentId` and
`npm run payments:reconcile`. The checkout offers online payment, and the order page handles every
payment state. 58 integration tests in `tests/integration/payments.test.ts` against a local gateway
stand-in, and 35 unit tests in `tests/payments.test.ts`.

**To finish verifying:** register a free SSLCOMMERZ sandbox store and run one payment through it; the
signature algorithm in particular is unconfirmed (ADR 0019, Consequences). Scheduling reconciliation and
delivering receipts and review events were done in M9. Resolving held
payments, refunding money that arrived too late, and cancelling were done in M8.

## M8 — Order management, cancellation, refunds — **implemented**
Customer order history/tracking; admin order transitions; eligibility rules; idempotent refund operations and audit.
**Tests:** invalid transition denied; customer sees own order only; duplicate refund cannot create duplicate provider refund; COD handled explicitly.

Delivered per [ADR 0020](decisions/0020-order-management-cancellation-refunds.md). Customers can cancel
until an order is being prepared (`POST /orders/:orderId/cancel`), and the order page shows progress,
tracking and refunds. For administrators, the API covers listing and finding orders, forward-only
transitions with tracking, recording cash collected, idempotent refunds through SSLCOMMERZ or by hand
for cash, and accepting or rejecting held payments. Every admin change is audited.
`npm run payments:reconcile` now also sends and completes refunds. 37 integration tests in
`tests/integration/order-management.test.ts` (including concurrent refunds, a lost provider answer and
two admins at once) and 7 unit tests in `tests/order-state.test.ts`.

The admin dashboard (`frontend/src/app/admin/`) has screens for all of it, and for the catalog,
inventory and customer APIs that previously had none (architecture.md §6).

**Provisional:** who may cancel when, and refunds generally, because PRD §9 has not decided them.
**Not done:** customer return or refund requests after delivery (no returns policy); a screen for
role changes (superadmin only) and image upload (no upload endpoint); confirming against the real
sandbox that SSLCOMMERZ ignores a repeated `refund_trans_id`. Scheduling the sweep and delivering the
cancellation, refund, shipping and review notifications were done in M9.

## M9 — Background jobs — **implemented; not yet verified against a real email relay**
Durable outbox/worker, receipts, shipping and low-stock messages, bounded exponential backoff with jitter, failed-job visibility/manual retry.
**Done when:** email outage does not invalidate order and retry behavior is observable/idempotent.

Delivered per [ADR 0021](decisions/0021-outbox-worker-and-email-delivery.md). `src/worker.ts`
(`npm run worker`, `npm run worker:dev`, or `npm run jobs:run-once` from a scheduler) claims due
`outbox_events` rows with `FOR UPDATE SKIP LOCKED`, sends them outside any transaction, and records the
outcome fenced by a `claim_token`: SENT, FAILED with a retry after bounded exponential backoff with
jitter (8 tries, about an hour), or DEAD. Every queued type has a handler: receipts, shipping,
cancellation and refund emails to the customer, low-stock and payment-review alerts to staff, and the
password-reset and verification links, whose payload is scrubbed once finished. Email goes through
Nodemailer: `.eml` files in development, any SMTP relay otherwise. The payment and refund sweep is now
a recurring job the worker runs every `RECONCILE_INTERVAL_MS`. Administrators see every job, a queue
summary and the sweep's state at `/admin/jobs`, and can retry one dead job or all of them (audited).
20 integration tests in `tests/integration/jobs.test.ts` (including checkout during an email outage,
concurrent workers, an expired lease and a stale worker, give-up, and the admin API), 16 unit tests in
`tests/jobs.test.ts`, and two new CHECK constraints in `tests/db/constraints.test.ts`.

**To finish verifying:** choose an email provider (PRD §9), configure SPF/DKIM/DMARC for `EMAIL_FROM`,
and send one of each message through it. **Not done:** `requireEmailVerification` stays off (no relay
anywhere yet, no "check your inbox" page); no metrics export beyond logs and the admin summary (M11/M12);
the per-job admin retry was exercised through the API and its tests, not clicked through in the browser.

## M10 — Admin completeness — **implemented**
Customer management, coupons/usage limits, shipping/tax/store settings, analytics, audit UI and bounded CSV operations.
**Tests:** sensitive actions audited; coupon limits cannot be exceeded concurrently; analytics query cost reviewed.

Delivered per [ADR 0022](decisions/0022-coupons-settings-and-admin-reporting.md). Coupons: admin CRUD (`modules/coupons`), a promo field at checkout, discounts
priced by the pure `pricing/coupons.ts`, and each use counted under a row lock inside the order's
transaction, after the stock claim; a cancelled or unpaid order gives its use back. Store settings
(`store_settings`, versioned and audited) now set delivery fees, express on/off, a free-delivery
threshold, an exclusive tax rate, and the store name and support email in emails. The dashboard opens
on an overview (`/admin`), and gains coupons, settings and audit-log screens, a CSV export of orders,
and the superadmin role change. Migration `admin_completeness`. 17 integration tests in
`tests/integration/admin-completeness.test.ts` (including 8 customers racing for 3 uses, a customer
racing their own per-customer limit, release on cancellation and on a failed payment, settings
conflicts, the overview's arithmetic, formula-safe CSV and audit of every export), 18 unit tests in
`tests/admin-completeness.test.ts`, and 5 new CHECK constraints in `tests/db/constraints.test.ts`.
The concurrent test found a deadlock between checkouts (a coupon locked `FOR UPDATE` against the
`FOR KEY SHARE` an order insert takes), fixed with `FOR NO KEY UPDATE`.

**Provisional:** the coupon rules (one per order, products only), exclusive-only tax and the default
fees, because PRD §9 has not decided them. **Query cost:** reviewed by reading the plans' indexes, not
under a measured load (M11/M12). **Not done:** coupon bulk generation, a coupon usage report beyond
`usedCount`, exports other than orders, and a retry of raw-query deadlocks in `withTransaction`.

## M11 — Hardening and testing — **implemented; CI not yet run on GitHub**
Unit tests for domain logic; PostgreSQL integration tests; Playwright browse→cart→checkout→tracking; concurrency, webhook, email, authorization, coupon/refund cases; dependency/security review; query/index review.
**Done when:** critical PRD scenarios automated, no unresolved critical/high issue, all UI states verified, logs contain no secrets.

Delivered per [ADR 0023](decisions/0023-end-to-end-tests-ci-and-hardening.md). A Playwright suite in
`e2e/` runs the real API and a production build of the storefront against its own reset-per-run
database (`commercecore_e2e`). Its journey: sign up, browse, pick a size, add to bag, check out cash on
delivery, see the persisted order, an administrator prepares and ships it with tracking, the customer
sees the tracking, and the receipt and shipping emails leave through the outbox. A stranger is refused
the order, and stock moved 5 → 4 with a movement. Other specs cover the storefront's states (listing,
search, sold-out size, unknown product, empty bag), access control (guest redirect and return, open
redirect, customer refused `/admin` and the admin API, guest refused private APIs, foreign Origin
refused), and an axe WCAG 2.1 AA gate on seven pages. `.github/workflows/ci.yml` runs every check on
each push and pull request.

The reviews found and fixed: the default storefront listing sorted the whole catalog (1,033 ms → 2 ms
at 20,000 products, with a migration, `catalog_featured_order_index`, and leaner counts and facets;
[docs/performance-review.md](performance-review.md)); a high advisory in `body-parser` (updated to
2.4.0); an inert "Continue with Google" button (removed); photo credits below AA contrast; and two
unredacted credential paths in logs (`tests/logger.test.ts` now covers every redacted path).

The server-side scenarios the plan lists (concurrency, webhooks, email outage, authorization,
coupons, refunds) were already automated in M2–M10, and all of them were re-run green for this
milestone. **Not done:** online payment, password-reset email and the admin catalog, coupon and
settings screens are not driven by a browser (their APIs have integration tests); mobile viewports;
a manual keyboard and screen-reader pass; the CI workflow's first run on GitHub. Dev-only moderate
advisories remain (lint and scaffolding tools). Price sorts and text search still scan the catalog
(about 300 ms and 200 ms at 20,000 products); the review gives the fix and when to apply it.

## M12 — Staging and production readiness — **engineering side done and rehearsed; real staging and the launch gates are open**
Staging deployment, secrets, backup/restore drill, migration/rollback or forward-fix runbook, monitoring/alerts, incident procedure, defined load test, policy/legal/privacy review, live provider approval and reconciliation.
**Done when:** smoke tests and restore drill pass; capacity is measured; launch gates are signed off.

Delivered per [ADR 0024](decisions/0024-staging-production-readiness.md), which **amends ADR 0006**:
production must be same-site, and the API refuses to boot otherwise. The cross-site layout ADR 0006
planned would have looped every signed-in customer back to sign-in, because the storefront reads the
session cookie (ADR 0014). Container images (`backend/Dockerfile`: API, worker and a one-shot migrate
job; `frontend/Dockerfile`: standalone Next) and a staging rehearsal (`deploy/staging/`): the
production images with `NODE_ENV=production` behind one origin, plus PostgreSQL, S3 (SeaweedFS) and
an SMTP relay that requires STARTTLS. The rehearsal passed the smoke test (16/16, including a session
reaching a protected page) and two restore drills (at 1.2M rows, restore in 33 s). A pre-release backup
restored and migrated forward. Email went out over STARTTLS, and the load test was measured
([load-test.md](load-test.md)). Runbooks: [deploy](runbooks/deploy.md),
[backup-restore](runbooks/backup-restore.md), [monitoring](runbooks/monitoring.md),
[incident-response](runbooks/incident-response.md); gates in [launch-gates.md](launch-gates.md). CI now
also builds the images and checks the topology guard.

Found and fixed on the way: `dotenv` was a dev dependency the API imports at boot (production installs
would not start); the frontend lockfile lacked Linux-only packages (CI's first Linux `npm ci` would have
failed); the restore procedure lacked `ANALYZE` (the rehearsal's listing ran at half throughput without
it); and the storefront sent no hardening headers and advertised `X-Powered-By`.

**Not done (each needs a decision or an outside party, launch-gates.md):** hosting, so no real staging,
managed point-in-time restore drill, or wired alerts; agreed RPO/RTO, SLO and load profile (proposals
written); live SSLCOMMERZ; the email provider; tax, shipping, returns, legal and privacy review. **Not
done (engineering):** a Content-Security-Policy, and caching of the whole-catalog counts and facets,
which bound throughput ([load-test.md](load-test.md)).

## M13 — Shopping assistant (RAG chat) — **implemented; not yet run against real Groq/OpenAI**
Storefront chat over Groq (answers) and, optionally, OpenAI (embeddings, fallback answers; without it the assistant runs on Groq alone with full-text policy search — ADR 0025 amendment): read-only tools over the catalog and the customer's own orders, pgvector retrieval over policy text and product descriptions, streamed replies, guest access to catalog/policy answers, 30-day conversation retention, audited admin review, daily usage budgets.
**Tests:** guest never gets order tools; cross-customer order access through the bot is refused; unpublished products never retrieved; live prices in answers; Groq failure falls back to OpenAI before the first token; both down leaves shopping untouched; budgets and limits enforced; retention purges; admin reads audited.
**Done when:** all of the above automated against a local provider stand-in, the widget's states verified in the browser, and an eval set run against the real providers with the owner's approval.

Delivered per [ADR 0025](decisions/0025-shopping-assistant-rag-groq-openai.md), with the plan in `docs/assistant-rag-plan.md` and setup in `docs/assistant-setup.md`. It sits after M12 in the milestone order, but was built before M12 finished, at the owner's request. M12's load profile and launch gates must therefore include the assistant and its two providers.

What was built:
- **Backend** (`modules/assistant`):
  - one `fetch` adapter for both vendors;
  - read-only tools over the catalog, delivery settings and the customer's own orders;
  - pgvector retrieval over the knowledge files and public products (migration `assistant`, the first extension);
  - streamed replies;
  - Groq → OpenAI fallback before the first word;
  - daily budgets;
  - the recurring index sweep and 30-day retention jobs;
  - audited admin review at `/admin/assistant`.
- **Storefront:** the "Ask us" widget.
- **Tests:**
  - 21 unit tests in `tests/assistant-providers.test.ts`, and three more in `tests/logger.test.ts`;
  - 27 integration tests in `tests/integration/assistant.test.ts`, against local stand-ins for both vendors;
  - 3 database tests;
  - 6 browser tests in `e2e/tests/assistant.spec.ts`.

**To finish verifying:** put real keys in `backend/.env`, run `npm run assistant:index` and `npm run assistant:eval -- --yes` (it costs API credit), and read the answers.

**Provisional:** every policy source is a draft (PRD §9).

**Not done:**
- a privacy notice naming Groq and OpenAI;
- a shared rate-limit store for more than one API instance;
- a single source for the FAQ text, which is duplicated in `faqs.ts` and the knowledge files.

## Definition of done for every feature
- [ ] Acceptance criteria met
- [ ] Server validation, authz and ownership checks implemented
- [ ] DB constraints/migrations reviewed
- [ ] Appropriate unit/integration/E2E tests pass
- [ ] Loading/empty/error/success states handled
- [ ] Logs are actionable and safe
- [ ] Docs/ADR updated
- [ ] Manual verification instructions and known limitations recorded
