# ADR 0009 — Identity, Authorization and Rate Limiting with Better Auth

- **Status:** Accepted
- **Date:** 2026-10-22
- **Builds on:** ADR 0006 (Express + Better Auth, separate deployables)
- **Implements:** `docs/implementation-plan.md` M2

## Context
ADR 0006 chose Better Auth and mounted it at `/api/v1/auth/*`, and the identity tables and
guards existed, but nothing used them: the API served only `/livez` and `/readyz`, the
guards were tested exclusively against a stubbed session, and several protections were
either absent or present only by accident of a library default.

Five things had to be decided to make M2 real.

## Decision

### 1. A three-level role ladder, not Better Auth's admin plugin
`UserRole` becomes `CUSTOMER < ADMIN < SUPERADMIN`. Ranking lives in exactly one place
(`ROLE_RANK` in `src/http/guards.ts`); guards express a *minimum* (`requireMinRole`), so a
superadmin satisfies an admin route without any route listing two roles.

SUPERADMIN exists for one reason: PRD §4 FR-05 asks for customer role management "with
least privilege". If granting ADMIN were itself an ADMIN operation, any administrator could
mint more administrators and nothing would sit above them. So `PATCH /admin/customers/:id/role`
requires SUPERADMIN, while day-to-day management stays at ADMIN.

Better Auth's `admin` plugin was rejected. It brings its own string `role` field, its own
`banned`/`banReason`/`banExpires` columns and `impersonatedBy` on the session — duplicating
the existing `UserRole`/`UserStatus` PostgreSQL enums and their CHECK constraints, and
adding impersonation nobody asked for. The cost of not using it is one function that
deletes session rows for a suspended user, which is what the plugin does anyway.

### 2. Express owns rate limiting; Better Auth's limiter is off
`rateLimit: { enabled: false }` in the auth config, and `src/http/rate-limit.ts` defines
every limit in the API. Two limiters would mean two windows, two memory stores and two
different error bodies for the same event; one means every refusal is the documented
`RATE_LIMITED` envelope with a request id.

Limits are layered rather than blanket. The previous single limiter covered the whole auth
subtree at 50 requests / 15 minutes — including `/get-session`, which the frontend reads on
navigation, so ordinary browsing would have been throttled. Now credential and
account-recovery endpoints get a small allowance (20 / 15 min), the rest of the subtree a
generous one (120 / min), and the application's own state-changing routes their own bucket.

### 3. Email verification and password reset go through the durable outbox
`sendResetPassword` and `sendVerificationEmail` write an `OutboxEvent` instead of calling a
provider inline, so an email outage cannot fail the request that triggered it
(architecture.md §11, commerce invariant 9). Two enum members were added:
`EMAIL_VERIFICATION` and `PASSWORD_RESET`.

The HTTP flows are complete and tested end to end — a reset token issued through
`/request-password-reset` actually changes the password and revokes existing sessions. The
**delivery is not implemented**: no email provider is selected (PRD §9) and the outbox worker
is M9, so rows accumulate as `PENDING` and nothing is sent. `requireEmailVerification` stays
`false` until both exist, or every new account would be locked out.

Trade-off: the payload holds the reset URL, so a token is readable with database access
between enqueue and send. Bounded by a one-hour token expiry; the M9 worker must clear
`payload` once a row reaches `SENT`.

### 4. CSRF: an Origin check on every cookie-authenticated state change
Better Auth checks the request origin for the endpoints it serves. Two gaps were found by
testing it rather than assuming it:

- **It only checks when the request carries a `Cookie` header.** Sound for the case that
  matters — a hostile page driving `change-password` with the victim's ambient session —
  but it leaves cookie-less cross-site `sign-in/email` accepted, i.e. login CSRF.
- **It turns itself off under `NODE_ENV=test`.** Unset, `disableOriginCheck` resolves to
  `isTest() ? true : false`, so the protection would be live in production and absent in
  the suite: no test could ever demonstrate it, and a regression in it would stay green.

So: `advanced.disableOriginCheck: false` and `disableCSRFCheck: false` are stated
explicitly and identically in every environment, and `requireTrustedOrigin`
(`src/http/origin.ts`) is mounted on the auth subtree *and* on the application's own routes,
which Better Auth's check never reaches. A request with no `Origin` header is allowed — a
browser cannot be made to issue a credentialed cross-site POST without one, so its absence
means a non-browser caller.

A synchroniser token was rejected: it would be a second mechanism for the same guarantee,
and a second thing to get wrong.

### 5. No session cookie cache
`session.cookieCache` is left disabled. It would serve the session from a signed cookie
without reading the database, so a revoked session, a suspended account or a demoted role
would keep working until the cache expired. Immediate effect is a requirement here —
suspension deletes session rows, and a promoted user is authorized on their very next
request with no re-login. The cost is one session lookup per request.

## Consequences
- Every protected subtree applies its guard with `router.use`, so a route added later is
  protected by default rather than by remembering.
- Ownership is enforced by scoping queries to `{ id, userId }` rather than loading a row and
  comparing afterwards; a foreign id matches nothing, so the answer is 404 and the response
  does not confirm the resource exists.
- Sensitive admin writes and their audit row commit in one transaction — if the change lands
  and the audit fails, the record of who did it is gone.
- `GET /api/v1/auth/list-sessions` is **not served**. Better Auth returns whole session rows
  there, including `token`; `GET /api/v1/me/sessions` returns the same listing without them.
- Rate-limit state is in-process memory, so limits are per instance. A second replica
  doubles the effective allowance. Moving to a shared store (Redis, or Better Auth's
  `storage: 'database'`) is required before scaling horizontally.
- Sign-in does not consult `status`: a suspended user can obtain a session, and every
  protected request then answers 403. Status is checked in exactly one place, the guard.
- The frontend declares Better Auth's additional fields by hand (ADR 0006 flagged this as a
  drift risk, and it drifted): `role`/`status` lacked `input: false` on the client, which
  made them *required* arguments to `signUp.email` while the server refuses a payload that
  carries them. A shared contracts package remains the real fix.

## Not in this ADR
Cart ownership (M5), product and inventory authorization (M3/M4) and order state transitions
(M8) are not implemented. When they land they belong behind these same guards, and their
sensitive writes need audit rows.

A separate, unresolved issue surfaced while enabling the database suite:
`OrderStatusHistory.actorUserId` and `AuditLog.actorUserId` declare `onDelete: SetNull`, but
their CHECK constraints require an actor or `is_system`. The two are mutually exclusive, so
a user who has acted on an order or performed an audited action cannot be deleted at all.
`tests/db/relations.test.ts` now records that behaviour and names the decision; resolving it
needs an ADR on retention and deletion (architecture.md §16).

## Revisit when
A second API instance is deployed (rate-limit store), an email provider is chosen
(verification and reset delivery, `requireEmailVerification`), or the frontend and API move
behind one origin, which would make most of the cross-origin cookie and CSRF handling above
unnecessary.
