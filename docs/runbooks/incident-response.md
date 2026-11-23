# Runbook — Incident response

For a small team: one person can hold several roles, but say out loud which ones you hold.

## Severity

| Level | Meaning | Examples | Response |
|---|---|---|---|
| **SEV1** | Customers cannot buy, or money/data is at risk | Site or checkout down; payments marked paid that were not; personal data exposed; a secret leaked | Now, all hands; update every 30 min |
| **SEV2** | A main flow degraded, with a workaround | Online payment down (cash on delivery works); emails not leaving; admin down | Within 1 hour; update every 2 h |
| **SEV3** | Minor or single-customer | One stuck order; one dead job | Next working day |

## Roles

- **Incident lead:** decides, keeps the timeline, calls the end. Makes the call on rollbacks,
  restores and maintenance mode.
- **Operator:** hands on keyboard; says what they are about to run before running it.
- **Communicator:** customers (status note on the storefront, support email) and the business.

## The first 15 minutes

1. **Acknowledge** the alert and name the incident lead.
2. **Write down the start time** and keep a timeline from here (a shared doc is fine).
3. **What changed?** The last deploy, migration, configuration change or provider notice. If a deploy
   in the last hour lines up, **roll back the application first** ([deploy.md](deploy.md)), then ask why.
4. **Scope it:** `readyz`, the storefront, a test checkout, `/admin/jobs`. Read errors by `requestId`.
5. **Stop the bleeding before fixing:** roll back, scale the worker to zero to stop bad emails, or
   take a provider out of service. Do not restore a database without the lead's decision.
6. **Tell people:** severity, impact, next update time.

## Playbooks

**API or database down.** `readyz` failing with the process up means the database: provider console,
connection limit, storage full, failover in progress. All API instances crash-looping right after a
deploy means configuration: the boot error lists the missing or invalid variable names (never their
values). Roll back the image or fix the variable.

**Checkout failing.** Check whether it is all orders or some: `OUT_OF_STOCK` and `COUPON_INVALID` are
customer-level, not incidents. All of them with 500s: read the error. Inventory never goes negative
by construction (CHECK constraint and conditional update, ADR 0004); if stock looks wrong, compare
`product_variants.stock_quantity` with the sum of `inventory_movements` for that variant before
touching anything.

**Online payment down (SSLCOMMERZ).** Checkout still offers cash on delivery. Orders waiting for
payment expire on their own and give their stock back. When the provider recovers, run
`npm run payments:reconcile` so payments it took during the outage are recorded (ADR 0019). Nothing
needs doing by hand unless the sweep reports a mismatch (then "Payment needs review" appears).

**Payment signature failures spike.** Either someone is forging notifications (they are being
refused, so no money state changes; nothing to undo) or the SSLCOMMERZ store password changed
without the secret being updated (every real notification fails). Check the provider panel for a
recent credential change. Update `SSLCOMMERZ_STORE_PASSWORD` and redeploy; the sweep then picks up the
payments that the refused notifications described.

**Emails not leaving.** Orders are safe: email is queued in the database, and an outage does not
roll anything back (ADR 0021). Fix the SMTP side, then retry dead jobs from `/admin/jobs` (audited).
Jobs still `FAILED` retry on their own with backoff.

**A secret leaked** (committed, pasted, logged). SEV1. Rotate first, investigate second:
- `BETTER_AUTH_SECRET`: rotating it signs everyone out. Do it.
- Database password, S3 keys, SMTP password, SSLCOMMERZ store password: rotate in the provider,
  update the secret store, redeploy API and worker.
- Then look in the audit log (`/admin/audit`) and the provider's logs for use of the leaked value
  between the leak and the rotation.

**An admin account is compromised.** Suspend it from `/admin/customers` (this revokes its sessions
immediately; there is no session cache). Read `/admin/audit` filtered by that actor for what it did:
refunds, price and stock changes, role changes, coupon changes. Reverse each through the normal admin
screens so the reversal is audited too.

**Personal data exposed.** SEV1. Contain it (take the leaking route down), preserve logs, and bring in
whoever owns legal and privacy; there may be a notification deadline under the applicable law. Do
not delete evidence.

## Ending it

The lead ends the incident when impact has stopped and the cause is understood well enough to know
it will not recur tonight. Then, within five working days, a **blameless postmortem**:

- Summary: what customers saw, for how long, how many were affected.
- Timeline, from the first signal to the all-clear.
- Root cause, and why the safeguards did not catch it.
- What went well and what did not.
- Actions, each with an owner and a date: one that fixes the cause, one that makes detection faster.
