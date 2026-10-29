# ADR 0007 — Shared Request, Async and UI-State Primitives

- **Status:** Accepted
- **Date:** 2026-10-21
- **Scope:** `backend/src/http/*`, `backend/src/lib/*`, `frontend/src/lib/*`,
  `frontend/src/components/common/*`, `frontend/src/hooks/*`

## Context

Milestone M1 calls for "shared UI/error/loading/empty patterns" and the per-feature
definition of done requires server validation, authorization and all four UI states on
every surface. Those obligations repeat on every endpoint and every screen: read the
request id, validate input, wrap the success envelope, map a thrown error to a status,
check the session and ownership, keep a transaction short, retry a provider call with
backoff — and on the client, unwrap the envelope, catch the failure, show a pending state.

Written per feature, each of those is a place to forget a cap, a check or an await. The
repeated shape is also what made the duplication visible already: the request-id helper
existed twice (`http/error-handler.ts` and `http/routes/health.ts`) with 11 lines of code
in the repository's HTTP layer.

## Decision

Extract the repeated shapes into one layer each side, and require new code to use it.

**Backend**

| Module | Owns |
|---|---|
| `http/request-context.ts` | Mints/validates the request id; single reader for handlers and the error middleware |
| `http/errors.ts` | `AppError` plus one constructor per stable error code (`notFound()`, `outOfStock()`, …) |
| `http/validation.ts` | `parseOrThrow` — the only place an untrusted value becomes a typed one; Zod issues become the documented `details[]` |
| `http/schemas.ts` | Reused input shapes: capped pagination, allow-listed sort, opaque id, slug, idempotency key |
| `http/route.ts` | `route()` — validation + success envelope + status for a handler that returns domain data |
| `http/guards.ts` | `requireAuth`, `requireRole`/`requireAdmin`, `withActor`, `actorOf`, `assertOwner` |
| `lib/async.ts` | `attempt` (failure as a value), `withTimeout`, `withRetry` with bounded jittered backoff, `runSafely` |
| `lib/transaction.ts` | `withTransaction` with short bounded timeouts and write-conflict retry |
| `lib/prisma-errors.ts` | Predicates for the Prisma failures that carry domain meaning |

**Frontend**

| Module | Owns |
|---|---|
| `lib/api-error.ts` | `ApiError`, user-safe `errorMessage`, `fieldErrors` for forms, `isRetryableApiError` |
| `lib/api-client.ts` | `apiFetch`/`apiGet`/`apiPost`/… — credentials, envelope unwrapping, `ApiError`, idempotency key |
| `components/common/*` | `LoadingState`/`LoadingRows`, `EmptyState`, `ErrorState`, `ErrorBoundary`, `AsyncBoundary`, `QueryState` |
| `hooks/use-async-action.ts` | Pending flag, error state, toast and double-submit guard for one-off actions |
| `components/providers/app-providers.tsx` | Query cache, theme and toast outlet the above depend on |

Deliberately **not** added: an `asyncHandler` wrapper. Express 5 already forwards a
rejected handler promise to the error middleware (verified against the pinned 5.3.0), so
such a wrapper would add a layer that does nothing. What routes actually repeat —
validation, envelope, status — is what `route()` centralises.

`ErrorBoundary` is built on Next 16's `catchError` rather than a hand-written React
boundary class, so `redirect()`/`notFound()` keep working and `retry()` re-renders inside
a transition.

## Consequences

- A new endpoint states its schemas and returns data; it cannot ship with an uncapped page
  size, an unvalidated body, a non-standard envelope or a leaked stack trace without
  stepping outside the shared layer, which is visible in review.
- Authorization is composed, not retyped: a missing guard means `actorOf` throws 401 rather
  than the handler acting for an anonymous caller.
- Error codes, their statuses and their default wording live in one file, so API_SPEC.md §1
  and architecture.md §13 have exactly one implementation.
- Retry, timeout and transaction policy are configurable per call site but have safe
  defaults: nothing is retried unless the caller says the failure is retryable, and only a
  rolled-back write conflict is retried inside a transaction.
- The layer must be kept honest: each addition needs a real second caller, or it becomes
  indirection for its own sake.

## Revisit when

A module in the table above grows rules that only one caller wants, or when the payment and
jobs milestones (M7/M9) show that outbox and webhook work needs its own primitives rather
than `lib/async.ts`.
