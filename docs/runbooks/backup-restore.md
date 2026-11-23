# Runbook — Backups and restore

**Drill script:** `deploy/backup/restore-drill.sh`. **Last drill:** 2026-11-14, see below.

## Policy (proposed — PRD §9 has not set RPO/RTO)

| | Proposal | Why |
|---|---|---|
| **RPO** (data you can lose) | ≤ 5 minutes | Managed PostgreSQL point-in-time recovery (WAL archiving) gives this; nightly dumps alone would mean up to a day of orders. |
| **RTO** (time to be serving again) | ≤ 1 hour | A restore at today's volume takes seconds to minutes (below); the hour is for deciding, provisioning and re-pointing. |
| Retention | 14 days PITR + 12 monthly dumps | Covers "found it a week later" and month-end reconciliation. Align with the retention policy once decided (PRD §9). |
| Where | A different account/region from the database | A backup that dies with the database is not a backup. |
| Encryption | At rest, by the provider; dumps encrypted before leaving the provider | They contain personal data (names, addresses, emails, phone numbers). |

What is backed up: **PostgreSQL** is the system of record (catalog, prices, stock, orders, payments,
refunds, jobs, audit). **Object storage** (product images) needs versioning or replication on the
bucket; the database holds only keys. Secrets are not in either and live in the secret store.

## Restore drill (do it quarterly, and after any change to backups)

Restores into a scratch database next to the source, then compares: applied migrations, the number
of constraints and indexes, the row count of every table, and sums over order totals, payments,
refunds, stock and the stock ledger.

```bash
export PATH="/c/Program Files/PostgreSQL/18/bin:$PATH"   # Windows; anywhere else pg_dump is on PATH
SOURCE_URL=postgresql://…/commercecore \
TARGET_URL=postgresql://…/commercecore_restore_drill \
  deploy/backup/restore-drill.sh
```

The target's name must contain `restore` or `drill`; the script drops and recreates it. Against
production, restore into a separate server, never next to the live database, and delete the copy
afterwards: it is personal data.

### Results, 2026-11-14 (PostgreSQL 18, development laptop)

| Source | Rows | Dump | Backup | Restore | Verify | Result |
|---|---:|---:|---:|---:|---:|---|
| Development database | ~19k | 1.6 MB | 1.8 s | 3.1 s | 1.4 s | **PASS**: 26 tables, 343 constraints, 105 indexes, all sums identical |
| `commercecore_perf` (docs/performance-review.md volume) | ~1.2M | 15 MB | 4.0 s | 32.9 s | 3.2 s | **PASS** |

So at five years of a busy store's volume, a dump-and-restore is well inside a one-hour RTO. A
managed point-in-time restore is a different mechanism (the provider replays WAL) and must be drilled
on the chosen provider once hosting is decided.

## Restoring for real

1. **Declare an incident** ([incident-response.md](incident-response.md)). Restoring is the incident
   lead's decision: it discards everything after the restore point.
2. **Stop writes:** scale the API and worker to zero (the storefront can stay up and fail closed).
3. **Restore to a new database** (point-in-time just before the damage, or the latest dump), never
   over the damaged one: it is evidence, and the way back if the restore is wrong.
4. **Collect planner statistics:** `vacuumdb --analyze-only --dbname=…`. A restore does not carry them,
   and without them the database plans blind: in the staging rehearsal the catalog listing served
   44 requests/s before this and 96 after.
5. **Verify** it with the drill's checks (`restore-drill.sh` compares against any reachable source).
6. **Re-point** `DATABASE_URL`, run the migrate job (a no-op unless the backup predates a release),
   start the API, then the worker, and smoke test.
7. **Reconcile what was lost:** payments the provider has but the database does not. Run
   `npm run payments:reconcile`; then check the SSLCOMMERZ merchant panel for transactions after the
   restore point, and contact those customers. Orders placed after the restore point are gone and
   must be re-entered from the provider's records and the customer's receipt email.
