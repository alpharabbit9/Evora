# ADR 0028 — Hosting on Vercel: Storefront-Forwarded API, Serverless Outbox Drain

- **Status:** Accepted. Chooses hosting, which [ADR 0024](0024-staging-production-readiness.md)
  left open ("Revisit when hosting is chosen"). ADR 0024's same-site rule is unchanged and still
  enforced at boot.
- **Date:** 2026-11-23
- **Related:** [ADR 0009](0009-identity-authorization-and-rate-limiting.md),
  [ADR 0014](0014-account-only-cart-and-protected-routes.md),
  [ADR 0021](0021-outbox-worker-and-email-delivery.md),
  [ADR 0025](0025-shopping-assistant-rag-groq-openai.md),
  [runbooks/vercel.md](../runbooks/vercel.md)

## Context
The storefront and the API are to be deployed as two Vercel projects, each with its own
`*.vercel.app` URL. Three things in the codebase assumed a long-running server:

1. **The session cookie.** `vercel.app` is on the Public Suffix List, so two Vercel hosts are two
   unrelated sites: no `Domain` attribute can cover both. The API set on its own host would never
   reach the storefront's `proxy.ts` or its Server Components, which is exactly the sign-in loop
   ADR 0024 refuses to boot into.
2. **The worker.** Email, payment reconciliation and the assistant's index sweep run in
   `node dist/worker.js`, a process that polls forever. A Vercel Function runs per request.
3. **The client address.** Rate limits and the assistant's guest allowance key on `req.ip`. Behind
   the storefront, every request would arrive from the storefront's own infrastructure.

## Decision
1. **The storefront forwards `/api/*` to the API** (`frontend/src/proxy.ts`, when
   `API_PROXY_TARGET` is set). The browser talks to one host, the cookie lands there, and the API's
   `FRONTEND_ORIGIN` and `BETTER_AUTH_URL` are both the storefront URL, which is the one-origin
   topology ADR 0024 prefers. Server Components call the API deployment directly.
2. **The API is one Vercel Function** (`backend/api/index.js`) serving the compiled `dist/` that
   `npm run vercel-build` produces with `tsc`, the same JavaScript as `node dist/server.js` and the
   container image. Vercel never compiles the TypeScript itself, so `nodenext` imports and the
   Prisma client behave as they do locally. `vercel.json` rewrites every path to that function.
3. **Migrations run in the production build**, after compilation, over `DIRECT_DATABASE_URL`.
   That is "once per release, before the new version takes traffic" (deploy.md); a failed
   migration fails the build and the previous deployment keeps serving. Preview builds never
   migrate.
4. **The outbox is drained without a worker**, by the shared `drainDueJobs`: right after each
   successful write (`OUTBOX_DRAIN_AFTER_WRITES`, on by default on Vercel; the request's
   invocation is kept alive with `waitUntil`), and by a schedule calling
   `GET /api/v1/internal/outbox/drain` with `Authorization: Bearer <CRON_SECRET>`. The outbox
   itself is unchanged: rows commit with the change they describe, a cut-short drain only delays a
   job until its lease ends, and the drains never take a row another holds.
5. **The visitor's address is forwarded with a shared secret.** The storefront sends the address its
   Vercel edge reported (`x-real-ip`), with `API_PROXY_SECRET`; the API believes it only when the
   secret matches, and strips both headers either way (`backend/src/http/client-ip.ts`).
6. **Boot checks for Vercel:** `NODE_ENV` must be `production` and `CRON_SECRET` must be set; a
   `.vercel.app` topology error names the proxy fix; `AUTH_COOKIE_DOMAIN=vercel.app` is refused.

## Consequences
- Local development and the container/staging path are unchanged: with `API_PROXY_TARGET` unset
  nothing is forwarded, and the worker still drains the outbox.
- Each API call from a browser crosses the storefront's proxy first, which adds a hop of latency.
- The Hobby plan allows a cron at most daily, so `vercel.json` schedules a daily drain; frequent
  recurring work depends on writes arriving, a Pro schedule, or an external scheduler
  (runbook). A write-triggered drain makes transactional email prompt either way.
- Preview deployments cannot sign in (one `FRONTEND_ORIGIN`), and recurring jobs longer than the
  300 s function limit are cut off and retried.
- Rate limiting stays per instance (ADR 0009); Vercel may run several instances.

## Alternatives
- **Two hosts with `SameSite=None` cookies:** ADR 0024 already rejected it; it cannot work while
  the storefront reads the cookie.
- **A custom domain with sibling subdomains:** supported already (`AUTH_COOKIE_DOMAIN`), and the
  better shape once a domain exists; it needs no proxy.
- **Vercel's zero-config Express detection:** it compiles the TypeScript itself, and its handling
  of `nodenext` `.js` specifiers, path mappings and the Prisma client is not documented. Building
  with `tsc` keeps one compiled artefact for every host.
- **`next.config` rewrites instead of `proxy.ts`:** they cannot add a per-request header, so the API
  could not tell visitors apart.

## Revisit when
A custom domain is bought (move to sibling subdomains and drop the proxy); traffic needs more than
a couple of instances (shared rate-limit store); or recurring jobs need more than 300 s.
