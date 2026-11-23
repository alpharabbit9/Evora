# CommerceCore — Launch gates

Production launch needs every gate **Met** and signed by the person who owns it (PRD §8). This
file records the evidence; it does not sign anything. Engineering cannot sign the business, legal or
provider gates, and the tests passing are not a substitute for those signatures.

Status as of 2026-11-14. **Met** = done with evidence · **Partial** = built, a named step remains ·
**Open** = needs a decision or an outside party.

## Engineering

| Gate | Status | Evidence / what remains | Sign-off |
|---|---|---|---|
| Critical PRD scenarios automated | **Met** | PRD §7 criteria map to tests: browse→checkout→tracking (Playwright, `e2e/`); manipulated price, invalid quantity, stock, expired coupon (`checkout.test.ts`, `admin-completeness.test.ts`); final-unit race (`inventory.test.ts`, `checkout.test.ts`); idempotency (`checkout.test.ts`); duplicate/out-of-order webhooks and browser closure (`payments.test.ts`); cross-customer access and admin denial (`authorization.test.ts`, `e2e/tests/access-control.spec.ts`); email outage (`jobs.test.ts`). ADR 0023. | |
| No unresolved critical/high issue | **Met** | `npm audit --omit=dev --audit-level=high` passes in both apps and in CI. Dev-only moderate advisories listed in ADR 0023. | |
| CI green on the release commit | **Partial** | `.github/workflows/ci.yml` exists and each step passes locally; **it has never run on GitHub** (nothing pushed yet). | |
| Production images build and run | **Met** (locally) | `backend/Dockerfile`, `frontend/Dockerfile`; the staging rehearsal (`deploy/staging/`) runs them with `NODE_ENV=production`. ADR 0024. | |
| Staging environment deployed | **Open** | Needs a hosting choice (PRD §9). Everything is provider-neutral containers; [runbooks/deploy.md](runbooks/deploy.md). | |
| Smoke tests pass on staging | **Partial** | `deploy/smoke/smoke.mjs` passes against the local rehearsal ([load-test.md](load-test.md) has the run); repeat against real staging. | |
| Backup/restore drill | **Partial** | `deploy/backup/restore-drill.sh` passed on the development database and on the 1.2M-row volume ([runbooks/backup-restore.md](runbooks/backup-restore.md)). Repeat with the chosen provider's point-in-time restore. | |
| RPO / RTO agreed | **Open** | Proposed ≤ 5 min / ≤ 1 h in the backup runbook; the business must accept them (PRD §9). | |
| Capacity measured | **Partial** | Defined load test run against the rehearsal on one laptop ([load-test.md](load-test.md)). Repeat on staging hardware before claiming numbers for production. | |
| Shopping assistant ready for launch (M13) | **Open** | Being built in another session (ADR 0025). Before launch: add it to the load mix and the smoke test; use a PostgreSQL image with pgvector in `deploy/staging/compose.yaml` and on the managed database; add its provider outages to the monitoring and incident runbooks. Its code does not build at the time of writing, so the images could not be rebuilt with it. | |
| Load profile and SLO agreed | **Open** | Proposed in [load-test.md](load-test.md); the business must set the expected peak (PRD §9). | |
| Monitoring and alerts wired | **Open** | Signals and thresholds defined in [runbooks/monitoring.md](runbooks/monitoring.md); the alerting tool comes with hosting. | |
| Incident procedure | **Met** | [runbooks/incident-response.md](runbooks/incident-response.md). Name the on-call people before launch. | |
| Migration, rollback and forward-fix procedure | **Met** | [runbooks/deploy.md](runbooks/deploy.md): expand-only migrations, forward-fix, failed-migration recovery. | |
| Logs contain no secrets | **Met** | Redaction list covered by `tests/logger.test.ts`; boot errors name variables, never values. | |
| Accessibility | **Partial** | axe WCAG 2.1 AA gate on seven pages passes (`e2e/tests/accessibility.spec.ts`). A manual keyboard and screen-reader pass is still owed. | |
| Security review | **Partial** | Dependency audit, authorization tests, Origin/CSRF checks, same-site cookie enforcement (ADR 0024), hardening headers. Not done: a Content-Security-Policy, and an independent review or penetration test. | |

## Business, legal and providers

| Gate | Status | What is needed | Owner | Sign-off |
|---|---|---|---|---|
| Live payment provider approval | **Open** | SSLCOMMERZ live store approved; one sandbox payment and one refund run end to end first (ADR 0019 lists the unconfirmed signature algorithm and `refund_trans_id` behaviour). | Business | |
| Payment reconciliation | **Partial** | `npm run payments:reconcile` runs every `RECONCILE_INTERVAL_MS`; a daily comparison with the provider's settlement report is a business process still to define. | Finance | |
| Email provider and sender domain | **Open** | Choose the relay; SPF, DKIM and DMARC for `EMAIL_FROM`; then turn on `requireEmailVerification` (ADR 0021). | Business + engineering | |
| Tax | **Open** | Inclusive or exclusive VAT, rates, invoices (ADR 0022: exclusive rate, default 0). | Accountant | |
| Shipping zones and fees | **Open** | Zones beyond Dhaka/elsewhere; real fees (ADR 0018, 0022). | Business | |
| Cancellation, refund and returns policy | **Open** | Provisional rules in ADR 0020; the returns policy does not exist; storefront copy (30-day returns) is not policy yet. | Business + legal | |
| Terms, privacy notice, cookie notice | **Open** | `/terms` and `/privacy` pages exist; their content has had no legal review. | Legal | |
| Data retention and deletion | **Open** | How long orders, addresses, audit logs and sent emails are kept; how a customer deletes their account (PRD §5). | Legal | |
| Guest checkout | **Open** | Signed-in only today (ADR 0018); decide before launch. | Business | |
| Display font licence | **Open** | `Brigends_Expanded.otf` is a personal-use demo (architecture.md §16); buy a licence or replace it. | Business | |
| Shopping assistant providers (M13, in progress) | **Open** | Groq and OpenAI accounts, keys in the secret store, and a privacy review of what customer text reaches them (ADR 0025). | Business + legal | |
| Sample reviews on the home page | **Open** | Labelled "Sample review"; replace with real reviews or remove before launch (architecture.md §6). | Business | |
