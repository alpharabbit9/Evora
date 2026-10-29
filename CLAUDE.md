# CommerceCore — Claude Code Instructions

## Mission
Build a production-minded, single-store e-commerce platform with a customer storefront and protected admin dashboard. Prioritize correctness, security, accessibility, maintainability, and tested business workflows over feature count.

## Read first
Before a task, read `docs/PRD.md`, `docs/architecture.md`, `docs/database-design.md`, `docs/API_SPEC.md`, `docs/implementation-plan.md`, relevant `docs/decisions/*.md`, and `SYSTEM_DESIGN_NOTES.md`/`INSTRUCTION.md` for learning-note tasks. If code and docs conflict, surface the conflict; do not silently pick one.

## Engineering rules
- Inspect the existing repository, framework version, scripts, and conventions before changing code.
- Work in small milestones; implement one feature end-to-end (UI, server logic, persistence, auth, error/loading/empty/success states, tests).
- Do not leave fake success states, inert buttons, placeholders presented as complete, or unrelated rewrites.
- Use TypeScript strict mode and the repository's package manager.
- Validate all untrusted input on the server. Client validation is UX, not security.
- Never trust client-provided price, discount, tax, shipping fee, role, payment state, or stock.
- Enforce authentication, ownership, and role authorization on every protected server operation.
- Use PostgreSQL constraints and concurrency-safe writes for critical invariants.
- Keep database transactions short; never wait on payment/email network calls inside a transaction.
- Make retried mutations idempotent where duplicate effects are harmful.
- Do not log passwords, tokens, secrets, payment credentials, or unnecessary personal data.
- Store secrets in environment/secret management; commit only safe `.env.example` placeholders.
- Add/update tests for changed behavior, especially concurrency, authorization, duplicate webhooks, invalid transitions, and provider failures.
- Keep documentation and ADRs synchronized with code.
- Do not commit, push, deploy, delete data, or run destructive migrations without explicit authorization.

## Architecture defaults
- Modular monolith; do not introduce microservices prematurely.
- Next.js, React, TypeScript, Tailwind CSS, shadcn/ui, PostgreSQL, Prisma unless the repository/user has selected otherwise.
- Thin route handlers; domain logic in services; persistence functions where they clarify boundaries.
- Use a maintained authentication/session solution; do not invent cryptography.
- Store image binaries in object storage and metadata in PostgreSQL.
- PostgreSQL is authoritative for catalog, prices, orders, payments, and inventory.
- Redis is optional and should be added only for a demonstrated need.
- Use a durable outbox/queue for email and background work; do not rely on in-memory fire-and-forget tasks in serverless hosting.

## Commerce invariants
1. Server computes final order totals from trusted persisted data.
2. Order items preserve purchase-time product name, SKU, unit price, and required details.
3. Inventory never becomes negative under concurrent checkout.
4. A browser redirect is not proof of payment; verify provider evidence/webhooks.
5. Deduplicate provider events and make state transitions idempotent.
6. Payment success remains recoverable if the browser closes.
7. Customers access only their own private resources.
8. Sensitive admin actions are authorized and audited.
9. Email outages do not invalidate committed orders.
10. Order/payment/reservation/refund transitions are explicit and validated.

## Task workflow
1. State goal and acceptance criteria.
2. Inspect relevant code/docs.
3. Propose the smallest safe plan.
4. Implement end-to-end.
5. Run applicable lint, type-check, tests, and build.
6. Report changed files, actual commands/results, limitations, and next step. Never claim a test passed unless run.
