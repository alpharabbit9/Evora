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

**Carried forward:** password-reset and verification links are queued in `outbox_events` but
nothing sends them — no email provider (PRD §9) and no outbox worker (M9), so
`requireEmailVerification` stays `false` until both exist. Cart ownership (M5), product and
inventory authorization (M3/M4) and order transitions (M8) are not built.

## M3 — Catalog and seed import
Category/product/variant/image schema; repeatable sample import; public search/filter/sort/pagination; admin catalog CRUD/archive; object storage.
**Done when:** runtime catalog comes from own DB; import rerun does not overwrite operational stock/prices; unpublished products remain private.

**In progress.** Done: the repeatable fashion catalog importer (`backend/scripts/catalog-import/`,
[ADR 0011](decisions/0011-catalog-import-provenance.md), `docs/fashion-catalog-setup.md`), the
provenance/gender/price-source migration, and an object-storage module with filesystem (dev) and
S3 drivers. Store currency is BDT (ADR 0008 amendment). Phase 3 added the public catalog API
(`/products`, `/products/facets`, `/products/:slug`, `/categories`), dev media serving at `/media`,
and the storefront listing (`/shop`, `/collections/{men,women,new}`, `/search`), product
(`/products/[slug]`) and bag (`/cart`) pages — [ADR 0012](decisions/0012-public-catalog-api-and-cart-ownership.md).
Not done: admin catalog CRUD.

## M4 — Inventory
Stock per variant, movements, low-stock thresholds, admin adjustment + reason/audit. Decide decrement-on-order vs timed reservation in ADR.
**Tests:** concurrent final-unit purchase never oversells; every adjustment has a movement record.

## M5 — Cart and pricing
Persistent account cart, secure guest cart, merge behavior, quantity/coupon preview and shared server pricing.

**Partly implemented** with the fashion catalog Phase 3 (ADR 0012): account and guest carts,
ownership, merge, server-side price/stock validation and line status. Not done: coupons, the shared
pricing module, a "price changed since added" notice (no price snapshot is stored).
**Done when:** ownership/token is checked, client totals are not authoritative, changed prices/stock are surfaced.

## M6 — Checkout and orders
Quote/create flow, shipping/contact snapshots, order/item snapshots, idempotency key/fingerprint, COD state, durable outbox event.
**Tests:** repeated same request returns prior result; same key/different payload conflicts; required writes roll back; catalog edits do not rewrite historical order.

## M7 — Sandbox payments/webhooks
Select provider, adapter, signed webhook verification, deduplication, state machine, retry/reconciliation.
**Tests:** invalid signature rejected; duplicate/out-of-order event safe; browser closure after payment recoverable; provider timeout creates recoverable state.

## M8 — Order management, cancellation, refunds
Customer order history/tracking; admin order transitions; eligibility rules; idempotent refund operations and audit.
**Tests:** invalid transition denied; customer sees own order only; duplicate refund cannot create duplicate provider refund; COD handled explicitly.

## M9 — Background jobs
Durable outbox/worker, receipts, shipping and low-stock messages, bounded exponential backoff with jitter, failed-job visibility/manual retry.
**Done when:** email outage does not invalidate order and retry behavior is observable/idempotent.

## M10 — Admin completeness
Customer management, coupons/usage limits, shipping/tax/store settings, analytics, audit UI and bounded CSV operations.
**Tests:** sensitive actions audited; coupon limits cannot be exceeded concurrently; analytics query cost reviewed.

## M11 — Hardening and testing
Unit tests for domain logic; PostgreSQL integration tests; Playwright browse→cart→checkout→tracking; concurrency, webhook, email, authorization, coupon/refund cases; dependency/security review; query/index review.
**Done when:** critical PRD scenarios automated, no unresolved critical/high issue, all UI states verified, logs contain no secrets.

## M12 — Staging and production readiness
Staging deployment, secrets, backup/restore drill, migration/rollback or forward-fix runbook, monitoring/alerts, incident procedure, defined load test, policy/legal/privacy review, live provider approval and reconciliation.
**Done when:** smoke tests and restore drill pass; capacity is measured; launch gates are signed off.

## Definition of done for every feature
- [ ] Acceptance criteria met
- [ ] Server validation, authz and ownership checks implemented
- [ ] DB constraints/migrations reviewed
- [ ] Appropriate unit/integration/E2E tests pass
- [ ] Loading/empty/error/success states handled
- [ ] Logs are actionable and safe
- [ ] Docs/ADR updated
- [ ] Manual verification instructions and known limitations recorded
