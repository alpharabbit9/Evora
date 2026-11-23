# ADR 0021 — Outbox Worker and Email Delivery

- **Status:** Accepted for development. The email **provider** is still open (PRD §9): this ADR
  decides how mail leaves the system, not who carries it.
- **Date:** 2026-11-11
- **Related:** [ADR 0003](0003-payment-webhooks-idempotency.md), [ADR 0009](0009-identity-authorization-and-rate-limiting.md),
  [ADR 0018](0018-checkout-orders-and-provisional-delivery.md), [ADR 0019](0019-online-payments-sslcommerz.md),
  [ADR 0020](0020-order-management-cancellation-refunds.md)

## Context
M2–M8 write a row to `outbox_events` inside each business transaction (receipts, shipping and
cancellation notices, refund updates, low-stock and payment-review alerts, password-reset and
verification links), and nothing read them. The payment and refund sweep (`npm run payments:reconcile`)
had to be scheduled by something outside the application. M9 asks for a durable worker with bounded
exponential backoff and jitter, observable retries, failed-job visibility and manual retry, and for an
email outage never to invalidate an order (PRD §7, commerce invariant 9).

## Decision
1. **PostgreSQL is the queue.** The existing `outbox_events` table, no Redis or broker (architecture.md
   §10: add Redis only for a demonstrated need). A row is committed with the change it describes, so
   no message exists for a change that rolled back and no change commits without its message.
2. **A separate worker process,** `src/worker.ts` (`npm run worker`, `npm run worker:dev`), so a slow
   relay never shares the API's event loop. `--once` (`npm run jobs:run-once`) drains what is due and
   exits, for hosts that can only schedule commands.
3. **Claiming** uses `SELECT … FOR UPDATE SKIP LOCKED` in a short transaction: any number of workers
   can poll and each due row goes to one of them. A claim sets `status = PROCESSING`, a fresh
   `claim_token`, increments `attempt_count` and sets `next_attempt_at` to the lease expiry (5 min;
   15 min for the sweep). The handler runs after commit, outside any transaction, bounded by a
   timeout well inside the lease (2 min; 12 min for the sweep). The outcome is written only `WHERE
   claim_token` still matches, so a worker whose lease ran out cannot overwrite the worker that took
   over. A row whose lease expired is due again; one that was on its last allowed try goes to DEAD
   instead, so a row that keeps crashing the worker cannot loop.
4. **Retries:** 8 tries for a one-off job. The delay after try *n* is
   `min(1 h, 30 s · 2ⁿ⁻¹)`, half fixed and half random ("equal jitter"), about an hour in total.
   A permanent failure (an SMTP 5xx, an address the relay refuses, the order no longer exists, a
   payload that does not parse, a link that already expired) is DEAD at once. Statuses: PENDING →
   PROCESSING → SENT, or → FAILED (retry scheduled) → … → DEAD.
5. **Delivery is at least once,** not exactly once: a worker that dies after the relay accepted a
   message but before recording it sends it again. The Message-ID is derived from the row's
   `dedupe_key`, so the copy carries the same Message-ID. Handlers read current state at send time
   and skip what no longer makes sense (a receipt for an order that has since closed, a shipping
   notice for a cancelled order); a skipped row is SENT with `Not sent: …` in `last_error`.
6. **Transport through Nodemailer** (10.2.1, pinned). `EMAIL_DRIVER=filesystem` (the default, refused
   in production) writes each message as an `.eml` file under `MAIL_ROOT` and sends nothing;
   `EMAIL_DRIVER=smtp` sends through any SMTP relay, with STARTTLS required in production. Every
   provider under consideration accepts SMTP, so choosing one is configuration.
   `EMAIL_DRIVER=disabled` (amendment, 2026-11-23) is the explicit "no relay yet" for a deployment:
   accepted in production, it fails every send permanently, so the row ends DEAD with the reason in
   `last_error` rather than SENT as if delivered. That is the email outage invariant 9 already
   tolerates, chosen on purpose. Recipients come from
   the database at send time: the order's contact email, or for staff alerts `STAFF_ALERT_EMAILS`, else
   every active administrator (none → DEAD, not "sent to nobody").
7. **Secrets in payloads:** a reset or verification link is replaced with `{ userId, scrubbed: true }`
   once its row is SENT or DEAD, and a link older than its lifetime (1 h / 24 h, shared with Better
   Auth through `AUTH_LINK_TTL_MS`) is not sent. A scrubbed row cannot be retried. Stored errors have
   email addresses and URLs removed and are capped at 500 characters (CHECK allows 1000); logs carry
   job id, type and attempt, never the error text or an address.
8. **The sweep is a recurring row,** `PAYMENT_RECONCILIATION` with key `recurring:payment-reconciliation`,
   created by the worker on start. Its lease makes one worker run it at a time; after a run it goes
   back to PENDING due `RECONCILE_INTERVAL_MS` later (default 5 min). A failing sweep is retried
   with backoff capped at that interval and is never DEAD.
9. **Admin visibility and retry** (`/admin/jobs`, behind `requireAdmin`, audited): list with status
   and type filters, a summary (counts, jobs due now, the oldest due time, the sweep's last and next
   run and failing streak), retry one FAILED/DEAD job, and retry up to 500 DEAD jobs at once. A retry
   requeues with a fresh set of tries; it is conditional on the status read, so two admins retrying
   at once retry once. Payloads are never returned, only an allow-listed `subject` of identifiers.

## Consequences
- An email or relay outage leaves orders, payments and accounts untouched; the work waits and is
  visible. Proven by `tests/integration/jobs.test.ts` (checkout with a failing transport).
- A retried email can arrive twice; the admin retry dialog says so.
- A hosted deployment runs two processes (API and worker), or the API plus a scheduled
  `jobs:run-once`. Both may run at the same time.
- An outage longer than about an hour leaves DEAD jobs that a person must retry. Retried expired
  account emails cannot be sent; the customer asks for a new link.
- `requireEmailVerification` stays `false`: no relay is configured anywhere yet, and the storefront
  has no "check your inbox" step.
- Not verified against a real relay. Before launch: choose a provider, configure SPF/DKIM/DMARC for
  the `EMAIL_FROM` domain, and send through it once.

## Alternatives
- **Redis/BullMQ or a managed queue:** a second source of truth to keep consistent with PostgreSQL,
  and operational cost without a measured need.
- **Send inline after commit:** a crash between commit and send loses the message, and a slow relay
  slows checkout.
- **A provider's HTTP API instead of SMTP:** ties the code to a provider before PRD §9 picks one; an
  adapter can be added behind `EmailTransport` later if one offers something SMTP does not.
- **Exactly-once delivery:** would need the provider to deduplicate on a key; SMTP has no such
  guarantee.

## Revisit when
Throughput needs more than one batch of 10 every few seconds per worker, a provider is chosen (an
HTTP adapter may be preferable), or the queue's latency or depth becomes a measured problem.
