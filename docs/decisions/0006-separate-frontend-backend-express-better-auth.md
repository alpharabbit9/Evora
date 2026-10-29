# ADR 0006 — Separate Frontend/Backend Deployables with Express and Better Auth

- **Status:** Accepted
- **Date:** 2026-10-21
- **Amends:** ADR 0001 (Modular Monolith) — the *deployment* half only; the modular-boundary half still stands.

## Context
ADR 0001 chose one deployable Next.js application and explicitly listed "separate
frontend/backend deployments from day one" as the rejected alternative.
`docs/architecture.md` §2 and §6 follow from that: the request boundary is Next.js route
handlers under `app/api/v1/`, and the suggested source tree is a single `src/`.

The project owner has instead directed a two-folder layout — `frontend/` and `backend/` —
with Express as the HTTP server and Better Auth for authentication. This ADR records that
divergence rather than leaving code and `architecture.md` in silent conflict.

The auth library itself was never fixed by an ADR: `docs/API_SPEC.md` §1 states "exact auth
library is a repository decision", and `architecture.md` §12 only requires a *maintained*
auth/session library. Better Auth satisfies that; it is not a divergence.

## Decision
1. Two deployables: `frontend/` (Next.js 16, React 19, Tailwind 4, shadcn/ui) and
   `backend/` (Express 5, Better Auth, Prisma 7, PostgreSQL).
2. The backend keeps the modular-monolith *internals* from ADR 0001 and
   `architecture.md` §4: one database, one process, explicit domain modules, cross-domain
   work inside single short transactions. This is not a move to microservices.
3. The API contract in `docs/API_SPEC.md` is unchanged — same `/api/v1` base path, same
   envelopes, same error codes. Only the server that implements it changes.
4. Better Auth is mounted at `/api/v1/auth/*` and owns credential hashing, session issuance
   and cookies. `role` and `status` are declared `input: false` so they are server-owned and
   cannot be self-assigned at registration.

## Consequences
- **Cross-origin auth becomes a real concern.** The session cookie is now set by a different
  origin than the one that reads it. This requires, and the code now sets: an explicit
  `trustedOrigins`/CORS allow-list, `credentials: 'include'` on the client, and
  `SameSite=None; Secure` cookies in production. A same-origin single app would not have
  needed any of it. Production must therefore terminate both on HTTPS; a same-site
  deployment (shared parent domain, or a proxy) is preferable and should be revisited.
- **CSRF protection must be deliberate.** `architecture.md` §12 asks for "CSRF protection
  appropriate to the auth model". With cross-site cookies the `SameSite=Lax` default no
  longer helps, so Better Auth's origin checking is load-bearing and must not be relaxed.
- Two `package.json` files, two lint/type-check/test runs, two deploy units, and two things
  to start in development. CI must run both.
- Next.js server-side data fetching now crosses a network hop to Express instead of calling
  a service in-process. Server Components must forward the incoming cookie explicitly.
- No shared TypeScript types across the boundary yet. The client's Better Auth additional
  fields are declared by hand in `frontend/src/lib/auth-client.ts` instead of inferred from
  the server `auth` type. A shared `packages/contracts` workspace is the way to fix this if
  the duplication starts drifting.
- `architecture.md` §2 ("Next.js route handlers") and §6 (single `src/` tree) are now
  historical for the transport layer. The module table in §4, the checkout/payment flow in
  §7, the inventory concurrency rule in §8 and the webhook rules in §9 are unaffected —
  they describe domain behavior, not where the HTTP server lives.

## Alternatives
- Keep ADR 0001 as written: one Next.js app, API in route handlers. Fewer moving parts and
  same-origin cookies, but rejected by the project owner.
- Express backend with a token/JWT model instead of cookies. Avoids cross-site cookie rules
  but moves token storage into the browser, which is worse for XSS exposure.

## Revisit when
The cross-origin cookie and CSRF handling proves fragile in staging, or type drift across
the boundary causes a real defect. Either is a reason to put both behind one origin (proxy
or shared parent domain) or to introduce a shared contracts package.
