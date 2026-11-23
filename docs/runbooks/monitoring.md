# Runbook — Monitoring and alerts

**Status:** the signals below exist in the code today; the alerting tool is not chosen (it comes with
hosting, PRD §9). Wire these into whatever the platform provides (log-based alerts at minimum), then
tick them off in [launch-gates.md](../launch-gates.md).

## Signals the system already emits

- **Health:** `GET /api/v1/livez` (process up, no database) and `GET /api/v1/readyz` (database
  reachable). Use `readyz` for load-balancer readiness and `livez` for restarts. Both containers
  also have a Docker `HEALTHCHECK`.
- **Logs:** one JSON object per line from the API and the worker (pino), with `level`, `msg`, a
  `requestId` on request-scoped lines (also returned to clients as `X-Request-Id`), and secrets
  redacted (`tests/logger.test.ts`). The `msg` values below are stable and safe to alert on.
- **Queue state:** `GET /api/v1/admin/jobs/summary` (admin session): counts by status, how many are
  due, retryable dead jobs, the oldest due job, and the payment sweep's last and next run. The
  same numbers are on `/admin/jobs`.
- **Edge logs:** status codes and latency per request (`deploy/staging/Caddyfile` logs JSON; use the
  platform's equivalent).

## Alerts

Page = someone acts now, day or night. Ticket = next working day.

| Alert | Condition | Severity | First step |
|---|---|---|---|
| API down | `readyz` failing from outside for 2 minutes | **Page** | [incident-response.md](incident-response.md) → "API or database down" |
| Error spike | `Unhandled error while serving request` > 5 in 5 minutes, or 5xx > 2% of requests over 5 minutes | **Page** | Find the `requestId`, read the line's `err`; recent deploy? roll back |
| Checkout failing | No `ORDER_RECEIPT` job created for 2 hours during opening hours **and** checkout 5xx > 0 | **Page** | Try a checkout on staging, then production with a test account |
| Payment signature failures | `Payment notification failed signature verification` > 3 in 10 minutes | **Page** | Either an attack or a changed store password; see the incident playbook |
| Payment needs review | any `Payment needs review` | Ticket (business hours: same day) | Open the order in `/admin/orders`, accept or reject the held payment |
| Refund outcome unknown | `Refund outcome unknown; will ask again` still present after 1 hour | Ticket | `npm run payments:reconcile`; check the SSLCOMMERZ panel |
| Dead jobs | `Outbox job is dead; it needs a person`, or `retryableDead` > 0 | Ticket | `/admin/jobs`: read the error, fix the cause (often SMTP), retry |
| Queue backing up | `due` > 100, or `oldestDueAt` older than 15 minutes | **Page** if receipts are delayed, else ticket | Worker running? `Outbox poll failed` in its logs? SMTP reachable? |
| Payment sweep stale | the sweep's last run older than 3 × `RECONCILE_INTERVAL_MS` | Ticket | The worker is down or stuck; restart it |
| Abuse | `Rate limit reached` > 100 in 5 minutes from one limiter, or `Rejected an untrusted origin` spikes | Ticket | Look at the source addresses at the edge; block there if hostile |
| Low stock | `LOW_STOCK_ALERT` emails (already sent to staff by the worker) | none | Merchandising, not operations |
| Database | connections > 80% of the limit, storage > 80%, replication/backup failure | **Page** for backup failure, ticket otherwise | Provider console |
| Certificates | TLS certificate expires in < 14 days | Ticket | Usually automatic; check the edge |

Thresholds are starting points for a small store; tune them after two weeks of real traffic.

## Dashboards (one screen)

Request rate and 5xx rate; p95 latency for `/api/v1/products`, `/api/v1/checkout` and the product
page; orders per hour (from the overview at `/admin`); the job summary numbers; database CPU,
connections and storage. The load test's results ([load-test.md](../load-test.md)) say where the
knees are.

## Not built yet

- No metrics endpoint (Prometheus or similar): latency percentiles come from the edge or the
  platform, not the app. Add one if the chosen platform cannot derive them from logs.
- No error-tracking service (stack traces with context). Logs carry `err` with its stack; a service
  is worth it once there is traffic.
- Webhook duplicates and reservation expiry are not separately logged as metrics; duplicates are
  handled silently and correctly (`webhook_events` unique key).
