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

# 2. Frontend — copy frontend/.env.example to frontend/.env.local, then:
cd frontend && npm install && npm run dev                            # http://localhost:3000
```

Keep both on `localhost` (not `127.0.0.1`): they are different sites to a browser, and the
development session cookie is `SameSite=Lax`, so mixing them makes sign-in fail silently.

Checks: `npm run lint`, `npm run typecheck`, `npm run build` in both. Backend tests are
`npm test` (no database), `npm run test:db` and `npm run test:integration` (both need
`DATABASE_URL_TEST` pointing at a **separate** database — they truncate every table).

Implemented so far: M1 foundation, M2 identity/authorization, the M3 catalog import (development
fashion catalog — see `docs/fashion-catalog-setup.md`), the public catalog API with the storefront
listing, search, product and bag pages, the cart core (ADR 0012), and the featured "Dark Edit"
(40 synthetic front-runners, `npm run catalog:dark-edit`, ADR 0013). Checkout, payments and admin
catalog management are not built yet.

These are production-minded design documents, not evidence that code is implemented, security-reviewed, load-tested, or approved for live payments. Resolve open provider, tax, shipping, privacy, inventory and operational decisions before launch. Copy the `CommerceCore/` folder into your repository root.
