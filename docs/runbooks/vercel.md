# Runbook — Deploying to Vercel

Two Vercel projects from this one repository: the **storefront** (`frontend/`, Next.js) and the
**API** (`backend/`, Express in one Vercel Function). Why it is shaped like this is ADR 0028; the
general release rules (expand-only migrations, forward-fix, rollback) are still
[deploy.md](deploy.md).

## Topology

```
browser ──► https://<storefront>.vercel.app
              ├── /api/*  ── frontend/src/proxy.ts ──► https://<api>.vercel.app/api/*   (Express)
              └── everything else                  ──► Next.js pages
```

The browser only ever talks to the storefront. Two `*.vercel.app` hosts can never share the
session cookie (`vercel.app` is a public suffix, so not even `AUTH_COOKIE_DOMAIN` helps), and the
storefront has to read that cookie (ADR 0014, ADR 0024). So the storefront forwards `/api/*` to
the API deployment, and the cookie the API sets lands on the storefront's host. Server Components
call the API deployment directly, forwarding the cookie.

With a custom domain you may instead use sibling subdomains (`shop.example.com`,
`api.example.com`, `AUTH_COOKIE_DOMAIN=example.com`) and skip the proxy; see [deploy.md](deploy.md).

## Before the first deploy: three outside services

Production refuses to start without them (`backend/src/config/env.ts`):

1. **PostgreSQL 17 with pgvector.** Neon (from the Vercel Marketplace) works and gives both URLs
   you need: a **pooled** one for `DATABASE_URL` and a **direct** one (`DATABASE_URL_UNPOOLED`) for
   `DIRECT_DATABASE_URL`. Put it in the same region as the API functions (Project → Settings →
   Functions → Region).
2. **An S3-compatible bucket with public read** for product images: Cloudflare R2, AWS S3 or
   Supabase Storage. Its public URL is `MEDIA_PUBLIC_URL`.
3. **An SMTP relay** for password-reset and order emails, with a sending domain you control
   (`EMAIL_FROM`). Any provider that speaks SMTP with STARTTLS or implicit TLS.

## 1. Create both projects

Import the repository twice. **API project:** Root Directory `backend`; `backend/vercel.json` sets
the framework (Other), install and build commands, the rewrite and the cron, so leave the build
settings at their defaults. **Storefront project:** Root Directory `frontend`, framework Next.js.
Note both production URLs: `https://<storefront>.vercel.app` and `https://<api>.vercel.app`.

Use each project's **production domain** (Project → Settings → Domains), never a per-deployment URL
such as `https://<api>-abc123-<team>.vercel.app`: Vercel's default Deployment Protection puts
those behind a Vercel login, so the storefront's proxy would get a login page instead of the API.

## 2. API environment variables (Production)

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | pooled connection string |
| `DIRECT_DATABASE_URL` | direct connection string, same database (used only by the build's migration step) |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | `https://<storefront>.vercel.app` (the **storefront**: that is where browsers reach the API) |
| `FRONTEND_ORIGIN` | `https://<storefront>.vercel.app` |
| `CRON_SECRET` | `openssl rand -base64 32` |
| `API_PROXY_SECRET` | `openssl rand -base64 32` (the storefront gets the same value) |
| `STORAGE_DRIVER` | `s3`, plus `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_URL` |
| `EMAIL_DRIVER` | `smtp`, plus `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, `STORE_NAME` |
| optional | `GROQ_API_KEY` + `GROQ_CHAT_MODEL` (assistant), `SSLCOMMERZ_*` (online payment, sandbox only) |

Leave `AUTH_COOKIE_DOMAIN` and `PAYMENT_CALLBACK_BASE_URL` unset: payment callbacks then go to the
storefront's `/api`, which forwards them. Deploy. The build (`npm run build:vercel`) generates the
Prisma client, compiles `dist/`, then runs `prisma migrate deploy` (production builds only; a
failed migration fails the build and the previous deployment keeps serving).

Check it: `https://<api>.vercel.app/api/v1/readyz` answers `{"status":"ready"}`. A misconfigured
variable shows up in the function logs as `Invalid environment configuration:` with the field name.

## 3. Storefront environment variables (Production)

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_API_URL` | `https://<storefront>.vercel.app` (the storefront itself) |
| `NEXT_PUBLIC_SITE_URL` | `https://<storefront>.vercel.app` |
| `NEXT_PUBLIC_MEDIA_URL` | the same value as the API's `MEDIA_PUBLIC_URL` |
| `API_PROXY_TARGET` | `https://<api>.vercel.app` |
| `API_PROXY_SECRET` | the API's `API_PROXY_SECRET` |

`NEXT_PUBLIC_*` values are baked in at build time: **redeploy** after changing any of them.

## 4. First data

The database starts empty. To create the first administrator, run the seed from your machine
against the production database (direct URL), with a 12+ character password:

```
cd backend
DATABASE_URL="<direct url>" SEED_ADMIN_EMAIL=you@yourdomain SEED_ADMIN_PASSWORD="<strong>" npm run prisma:seed
```

This uses your local `.env` for everything else, so it runs in development mode and also adds the
demo categories and products. The catalog you imported locally (and its images under
`.data/media`) does not move by itself: that needs a database copy and an upload of the images to
the bucket.

## 5. Verify

```
node deploy/smoke/smoke.mjs https://<storefront>.vercel.app
```

All checks should pass. `--account` also signs up a throwaway customer and proves the session
reaches a protected page; run it only if a test account in production is acceptable.

## Background jobs

There is no worker process on Vercel. The outbox (ADR 0021) is drained:

- **after every successful write**, inside that request's function (`OUTBOX_DRAIN_AFTER_WRITES`,
  on by default on Vercel), so a password-reset email leaves within seconds;
- **by Vercel Cron** at `GET /api/v1/internal/outbox/drain` with `Authorization: Bearer $CRON_SECRET`.
  `vercel.json` schedules it once a day, because the Hobby plan refuses anything more frequent
  (the deployment fails). On Pro, change the schedule to `*/5 * * * *`. On Hobby, any external
  scheduler can call the same URL every few minutes:
  `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<api>.vercel.app/api/v1/internal/outbox/drain`

Recurring work (payment reconciliation, the assistant's index sweep) runs whenever a drain finds it
due. A job interrupted by a function timeout is retried once its lease runs out.

## Local development is unchanged

`backend/.env` and `frontend/.env.local` stay as they are: the browser calls
`http://localhost:4000` directly, and `npm run worker:dev` drains the outbox. Leave
`API_PROXY_TARGET` unset locally. To rehearse the Vercel shape on one machine, start the
`backend-vercel-rehearsal` and `frontend-vercel-rehearsal` launch configurations
(`.claude/launch.json`, ports 4040 and 3040) and run the smoke test against
`http://localhost:3040`.

## Known limits

- **Preview deployments** are not supported: the API accepts only `FRONTEND_ORIGIN`, so sign-in
  works on the production storefront URL only, and preview builds never migrate. Without Preview
  environment variables a preview build of the API fails; that is expected.
- **Rate limits are per function instance** (memory store, ADR 0009). Vercel may run several.
- **Request bodies are capped at 4.5 MB** by Vercel; API bodies are limited to 100 kB anyway.
- **Functions stop at 300 s** (Hobby and Pro default). Recurring jobs may take up to 12 minutes on a
  worker; on Vercel a very long one is cut off and retried.
- **Visitor addresses** reach the API only with `API_PROXY_SECRET` on both projects. Without it,
  every visitor shares the storefront's address for rate limits and the assistant's guest allowance.
