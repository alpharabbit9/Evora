# Runbook — Deploying a release

**Applies to:** staging and production. **Decided in:** [ADR 0024](../decisions/0024-staging-production-readiness.md).
**Rehearsed:** locally with `deploy/staging/` (production images, `NODE_ENV=production`).

## What is deployed

| Unit | Image | Command | Instances |
|---|---|---|---|
| API | `backend/Dockerfile`, target `runtime` | `node dist/server.js` | 1+ (see rate limits below) |
| Worker | same image | `node dist/worker.js` | 1+ (`FOR UPDATE SKIP LOCKED` makes extra workers safe) |
| Migrate | `backend/Dockerfile`, target `migrate` | `npx prisma migrate deploy` | one-shot, once per release |
| Storefront | `frontend/Dockerfile` | `node server.js` | 1+ |

The storefront image bakes in `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_MEDIA_URL` and
`NEXT_PUBLIC_SITE_URL`, so build one image per environment. `NEXT_PUBLIC_SITE_URL` is the
storefront's own public origin, used for canonical links, Open Graph images, `robots.txt`, the
sitemap and JSON-LD; left unset, those point at `http://localhost:3000`. Everything else is read from the environment at start.

## Topology (required)

The storefront and the API must be **same-site** or customers cannot stay signed in (ADR 0024). The
API refuses to start in production otherwise. Choose one:

1. **One origin (preferred):** `https://shop.example.com` serves the storefront, and the edge routes
   `/api/*` to the API. Set `FRONTEND_ORIGIN` and `BETTER_AUTH_URL` to that origin and
   `NEXT_PUBLIC_API_URL` to the same value. `deploy/staging/Caddyfile` is the reference routing.
2. **Sibling subdomains:** `https://shop.example.com` and `https://api.example.com`, with
   `AUTH_COOKIE_DOMAIN=example.com`.
3. **Vercel, two `*.vercel.app` projects (ADR 0028):** a variant of (1) where the storefront itself
   forwards `/api/*` to the API deployment (`API_PROXY_TARGET`). Step by step in
   [vercel.md](vercel.md).

Either way: TLS at the edge, HSTS set there, and the edge must pass `X-Forwarded-For` (the API trusts
exactly one proxy hop, `trust proxy 1`; with more hops, rate limits see the proxy's address).

## Environment

`backend/.env.example` lists every variable. Production refuses to start without: a real
`BETTER_AUTH_SECRET`, `STORAGE_DRIVER=s3` with bucket, keys and `MEDIA_PUBLIC_URL`,
`EMAIL_DRIVER=smtp` with `SMTP_HOST` (STARTTLS is required unless `SMTP_SECURE=true`), an
`EMAIL_FROM` on a real domain, https origins, and a same-site topology. Secrets come from the
platform's secret store, never from an image or a file in the repository. Set `API_INTERNAL_URL` on
the storefront to the API's private address when there is one.

**Rate limits are per API instance** (ADR 0009): with N instances a client gets N times the
allowance. Fine for 1–2 instances; beyond that, move the limiter to a shared store first.

## Release procedure

1. **CI is green** on the exact commit (`.github/workflows/ci.yml`).
2. **Build and tag** images with the commit SHA. Never deploy `latest`.
3. **Read the migrations** in this release (`backend/prisma/migrations/*/migration.sql`). Each must be
   *expand-only*: the previous release keeps running while it applies, and must keep working after
   (add columns nullable or defaulted, add tables and indexes; no drops or renames of anything the
   previous release reads). A contracting change ships in a later release, after nothing reads the
   old shape. No migration may drop a CHECK constraint or partial index by accident
   (`database-design.md`); `tests/db/constraints.test.ts` would fail if it did.
4. **Confirm a fresh backup** exists (managed snapshot, or `pg_dump` per
   [backup-restore.md](backup-restore.md)) when the release has a migration.
5. **Run the migrate job** once. It is idempotent: a re-run applies nothing new. Large tables: an
   index on a big table should be created `CONCURRENTLY` in its own migration, so it does not lock writes.
6. **Roll out** API, then worker, then storefront. The API and worker stop gracefully on SIGTERM
   (in-flight requests get 10 s; the worker finishes its batch, at most 30 s; a job cut short is
   re-claimed when its lease ends).
7. **Smoke test** the public origin:
   ```bash
   node deploy/smoke/smoke.mjs https://staging.example.com --account   # staging
   node deploy/smoke/smoke.mjs https://shop.example.com                # production: read-only
   ```
8. **Watch** for 15 minutes: error rate, `Unhandled error while serving request`, checkout failures,
   job queue (see [monitoring.md](monitoring.md)).

## Rolling back

- **Application:** redeploy the previous image tag. Safe whenever step 3 held (expand-only), which is
  the reason for that rule.
- **Database: forward-fix, do not roll back.** Prisma has no down migrations, and restoring a backup
  discards every order, payment and refund since it was taken. Write a corrective migration and ship
  it as a new release. Restore from backup only for data loss or corruption
  ([backup-restore.md](backup-restore.md)), and only on the incident lead's call.
- **A migration failed half-way:** the migrate job exits non-zero and `_prisma_migrations` records the
  failure; the old release is still serving. Fix the cause, undo any partial change by hand in a
  transaction, then `npx prisma migrate resolve --rolled-back <migration_name>` and run the migrate
  job again. Never `prisma migrate reset` or `prisma db push` against a shared database.

## Never

- Run migrations from each API instance at boot (two instances race, and a failure takes the API down).
- Point the integration, E2E or perf suites at a shared database; they truncate every table.
- Run `deploy/load/load-test.mjs` against production without telling whoever is on call.
