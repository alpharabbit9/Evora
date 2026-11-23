# CommerceCore Production Documentation Pack

This pack consolidates the supplied `Ecommerce App.md` specification and previous CommerceCore system-design learning.

- `CLAUDE.md` — Claude Code project rules
- `docs/PRD.md` — product scope and acceptance criteria
- `docs/architecture.md` — HLD, LLD, critical flows, security and operations
- `docs/database-design.md` — entities, relationships, constraints, indexes and transactions
- `docs/API_SPEC.md` — proposed REST contracts, access rules, errors and idempotency
- `docs/decisions/` — architecture decision records, including unresolved inventory policy
- `docs/implementation-plan.md` — ordered implementation and production-readiness milestones
- `SYSTEM_DESIGN_NOTES.md` — existing Lessons 1–2 with interview Q&A
- `INSTRUCTION.md` — future system-design lesson workflow

## Running it locally

Two deployables (ADR 0006). PostgreSQL must be running.

```bash
# 1. Backend — copy backend/.env.example to backend/.env and fill in DATABASE_URL and
#    BETTER_AUTH_SECRET (generate: openssl rand -base64 32), then:
cd backend && npm install && npm run prisma:deploy && npm run dev   # http://localhost:4000

#    In a second terminal, the background worker (emails, retries, the payment sweep):
cd backend && npm run worker:dev

# 2. Frontend — copy frontend/.env.example to frontend/.env.local, then:
cd frontend && npm install && npm run dev                            # http://localhost:3000
```

Keep both on `localhost` (not `127.0.0.1`): they are different sites to a browser, and the
development session cookie is `SameSite=Lax`, so mixing them makes sign-in fail silently.

Checks: `npm run lint`, `npm run typecheck`, `npm run build` in both. Backend tests are
`npm test` (no database), `npm run test:db` and `npm run test:integration` (both need
`DATABASE_URL_TEST` pointing at a **separate** database — they truncate every table).

Browser tests (ADR 0023) live in `e2e/`. They start their own API (port 4010) and production
storefront build (port 3010) against `commercecore_e2e`, which they create and reset on every run,
on the same server as `DATABASE_URL_TEST` (or set `DATABASE_URL_E2E`). Stop nothing; they don't touch
your dev servers or data:

```bash
cd e2e && npm install && npx playwright install chromium && npm test
```

Query cost: `npm run perf:explain` in `backend/` fills a `…_perf` database with a defined volume and
prints measured plans (`docs/performance-review.md`). CI (`.github/workflows/ci.yml`) runs all of
the above on every push and pull request.

## Deploying

Production must be **same-site**: the API served under the storefront's host at `/api` (preferred),
or on a sibling subdomain with `AUTH_COOKIE_DOMAIN`. The API refuses to start otherwise (ADR 0024).
Images: `backend/Dockerfile` (API, worker, migrate job) and `frontend/Dockerfile`. The procedure,
including migrations and rollback, is `docs/runbooks/deploy.md`; what still blocks launch is
`docs/launch-gates.md`.

A production-mode rehearsal of the whole stack on one machine (Docker):

```bash
cd deploy/staging && ./setup.sh && docker compose up -d --build   # http://localhost:8080
node deploy/smoke/smoke.mjs http://localhost:8080 --account          # from the repository root
```

Implemented so far: M1 foundation, M2 identity/authorization, the M3 catalog import (development
fashion catalog — see `docs/fashion-catalog-setup.md`), the public catalog API with the storefront
listing, search, product and bag pages, the cart core (ADR 0012), and the featured "Dark Edit"
(40 synthetic front-runners, `npm run catalog:dark-edit`, ADR 0013). The pieces on the home page's
clothes rail are synthetic products too (`npm run catalog:rail`, ADR 0027). The bag, wishlist and account
are signed-in only (ADR 0014), every store route has a matching skeleton and a view-transition
fade (ADR 0015), and customers can save products to a wishlist from any product card (ADR 0016).
The home page's "Recent Arrivals" clothes rail hangs curated pieces side-on, each turning to
face the front on hover, focus or tap (ADR 0027). A production build hides sample reviews and any FAQ answer or store promise that still
waits on a decided policy, and the newsletter shows no form until sign-up has a backend (ADR 0026;
`NEXT_PUBLIC_SHOW_UNCONFIRMED_CONTENT=true` shows them for a staging review). Homepage design work
follows the phased roadmap in `plan.md`.
Checkout works for signed-in customers with cash on delivery, ending at a persisted order page
(ADR 0018). Its delivery fees and zones are provisional development defaults. Online payment goes
through the SSLCOMMERZ sandbox, whose hosted page offers bKash, cards and mobile banking (ADR 0019).
Without credentials the store offers cash on delivery only; `npm run payments:fake-gateway` in
`backend/` lets you try the online flow locally with no account. It has been tested only against that
local stand-in so far, not the real sandbox. Customers can
follow an order's progress and cancel it until it is being prepared; administrators can move orders
through fulfilment, record cash collected, refund and resolve held payments (ADR 0020). The admin
dashboard at `/admin` covers orders, products, categories, inventory, stock history and customers;
an account needs the ADMIN role, which `npm run prisma:seed` grants to `SEED_ADMIN_EMAIL`.
A background worker (ADR 0021) sends receipts, shipping, cancellation and refund emails, staff alerts
and password-reset links, retries failures with backoff, and runs the payment and refund sweep every
few minutes; `/admin/jobs` shows what it did and retries what gave up. In development mail is written
as `.eml` files under `backend/.data/mail` and nothing is sent; set `EMAIL_DRIVER=smtp` to use a relay
(no provider has been chosen yet). The dashboard opens on a sales overview and also manages coupons
(entered by customers at checkout), delivery fees, tax and store details, the audit log and order
exports (ADR 0022).

These are production-minded design documents, not evidence that code is implemented, security-reviewed, load-tested, or approved for live payments. Resolve open provider, tax, shipping, privacy, inventory and operational decisions before launch. Copy the `CommerceCore/` folder into your repository root.
