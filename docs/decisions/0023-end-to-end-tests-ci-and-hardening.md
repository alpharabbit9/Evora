# ADR 0023 — End-to-End Tests, CI and the M11 Hardening Pass

- **Status:** Accepted for development. The CI workflow has not run on GitHub yet: it runs on the
  first push that includes it. Every step in it was run locally first.
- **Date:** 2026-11-14
- **Related:** [ADR 0009](0009-identity-authorization-and-rate-limiting.md),
  [ADR 0011](0011-catalog-import-provenance.md), [ADR 0013](0013-featured-dark-edit.md),
  [ADR 0014](0014-account-only-cart-and-protected-routes.md),
  [ADR 0018](0018-checkout-orders-and-provisional-delivery.md),
  [ADR 0021](0021-outbox-worker-and-email-delivery.md)

## Context
M11 asks for automated critical PRD scenarios, a Playwright journey from browsing to tracking,
dependency/security and query/index reviews, all UI states verified, and logs without secrets.
Before it: 242 unit, 76 PostgreSQL-constraint and 391 HTTP-integration tests covered the server
thoroughly, including every concurrency, webhook, refund, coupon and email-outage case the plan
names. Nothing exercised a browser, so nothing proved that the storefront, the cookies across two
origins, the proxy guard, the admin screens and the API work together. There was no CI.

## Decision
1. **One Playwright suite in `e2e/`, against the whole real stack.** Its own package (it drives
   both apps, so it belongs to neither). `playwright.config.ts` starts the API with `tsx` and the
   storefront as a production build (`next build` + `next start`). Testing `next dev` would test
   a different bundle, and its first-visit compiles make timings flaky.
2. **A dedicated, reset-per-run database, `commercecore_e2e`.** The API's start command runs
   `prisma migrate deploy` and `backend/scripts/e2e/prepare.ts` before it listens, so a run always
   starts from the same fixture: one product in three sizes (one sold out), one photo, one
   superadmin. `prepare.ts` refuses a database whose name lacks "e2e" and refuses production.
   Ports are 4010/3010, so a run never collides with development, and the storefront builds into
   `.next-e2e` (`NEXT_DIST_DIR`), leaving the normal build alone.
3. **Customers are created through the sign-up page,** never in the fixture, so registration is
   tested on every run, and each spec makes its own so none depends on another's leftovers.
4. **Online payment is off in E2E.** The store id and password are blanked, so the journey is cash on
   delivery. SSLCOMMERZ flows stay covered by `backend/tests/integration/payments.test.ts` against
   the local gateway stand-in. Putting the stand-in in the browser suite would test that stand-in
   more than the store.
5. **Every refusal is checked twice,** on the page and by calling the API directly with the same
   session, because a hidden control is not authorization (PRD §3).
6. **Accessibility is a gate at `serious`/`critical`.** axe runs WCAG 2.1 A/AA rules on home,
   shop, product, sign-in, sign-up, bag and checkout. Lesser findings are attached to the report
   but do not fail the run, so the gate stays a gate rather than a backlog.
7. **CI runs everything** (`.github/workflows/ci.yml`): backend types, lint, format, unit,
   constraint and integration tests and build; frontend types, lint and build; then the E2E suite.
   PostgreSQL is a service container per job, and `BETTER_AUTH_SECRET` is generated per run. Each
   app fails CI on a **high** or **critical** advisory in production dependencies
   (`npm audit --omit=dev --audit-level=high`).
8. **The SQL publication rule is complete by itself.** `PUBLIC_PRODUCT_SQL` now includes rule 4
   (a sellable variant) as an `EXISTS`, and counts and facets use `MATCH_FROM`, with no
   per-product price. Previously rule 4 relied on `LISTING_FROM`'s price join, so a query that
   used the condition with another FROM would have shown unsellable products, and every count paid
   for a price it never read. See docs/performance-review.md.

## What the pass found and fixed
- **The default storefront listing scanned the whole catalog:** 1,033 ms at 20,000 products,
  about 130 ms at today's 2,744. A composite index matching the `featured` ORDER BY makes it about
  2 ms; the count went from 528 ms to about 90 ms (migration `catalog_featured_order_index`).
- **A high-severity advisory in a production dependency:** `body-parser` 2.3.0 under Express
  (GHSA-27r3-jxmh-p828, DoS via trailing bytes after a compressed body), updated to 2.4.0. The
  frontend's copy came only through the `shadcn` CLI and was updated too.
- **An inert control:** "Continue with Google" on sign-in and sign-up only showed a "not available
  yet" toast. Removed; it can return when social sign-in exists.
- **Contrast below WCAG AA:** three 10px photo credits at 45–55% opacity, about 3.3:1 on ivory;
  raised to 70% (about 5.9:1). Found by the axe gate.
- **Redaction gaps:** the SSLCOMMERZ credential (`store_passwd`, `storePassword`) and outbox
  `payload.url` (password-reset links) were not in the redaction list; added, and
  `tests/logger.test.ts` asserts every redacted path.

## Consequences
- An E2E run takes about 5–7 minutes locally, mostly the production build.
- A streamed page answers a missing product with HTTP 200 and `noindex`, not 404, because the
  status line is sent before the product read finishes. The suite asserts the not-found content
  and the `noindex`, the behaviour that keeps such URLs out of search results.
- The fixture's product is defined twice (`prepare.ts` and `e2e/fixtures.ts`); both files say so.

## Known limitations
- **Not covered by the browser suite:** online payment (decision 4), password reset by email link,
  the admin catalog/coupon/settings screens (their APIs have integration tests), and mobile
  viewports.
- **Dev-only advisories remain** (moderate/low): `minimatch` under typescript-eslint and
  `deepmerge`/`ts-morph` under the `shadcn` CLI. Clearing them needs major upgrades of lint and
  scaffolding tools; nothing in the shipped app depends on them.
- **`pg` deprecation warning** in the integration suite ("client.query() when the client is
  already executing a query"): it comes from inside Prisma's adapter during an interactive
  transaction, not from application code. Harmless with `pg@8`; it must be resolved upstream (or by
  pinning `pg` below 9) before `pg@9`.
- axe covers roughly a third of real accessibility problems. A manual keyboard and screen-reader
  pass is still owed before launch (PRD §5).

## Alternatives
- **Cypress:** a single browser engine per run in its free tier, and weaker multi-context
  support. The journey needs a customer, a stranger and an admin side by side.
- **Mocked API in browser tests:** fast, but it would prove nothing about cookies across origins,
  the proxy guard or the real authorization.
- **Seeding customers in the fixture:** faster, but registration would go untested.

## Revisit when
- Online payment goes live in sandbox with a public callback URL: add a browser journey through
  SSLCOMMERZ's sandbox page.
- The catalog passes ~10,000 products: store a minimum price and add trigram search indexes
  (docs/performance-review.md).
- An email provider is chosen: assert delivery through it rather than `.eml` files.
