# ADR 0024 — Same-Site Deployment, Container Images and the Staging Rehearsal

- **Status:** Accepted. Decision 1 **amends [ADR 0006](0006-separate-frontend-backend-express-better-auth.md)**:
  production must be same-site, which ADR 0006 called "preferable" and left to staging. Hosting is
  still undecided (PRD §9); everything here is provider-neutral.
- **Date:** 2026-11-14
- **Related:** [ADR 0009](0009-identity-authorization-and-rate-limiting.md),
  [ADR 0014](0014-account-only-cart-and-protected-routes.md),
  [ADR 0019](0019-online-payments-sslcommerz.md), [ADR 0021](0021-outbox-worker-and-email-delivery.md),
  [ADR 0023](0023-end-to-end-tests-ci-and-hardening.md)

## Context
M12 asks for a staging deployment, secrets handling, a backup/restore drill, a migration and
rollback procedure, monitoring and alerts, an incident procedure, a defined load test and the
launch gates. Before it there were no container images, no production start path beyond
`npm start`, and nothing had ever run with `NODE_ENV=production`.

Reading the production path turned up three defects that no test could have caught, because every
test runs in development mode:

1. **Customers could not stay signed in under the documented production layout.** ADR 0006 planned
   for the storefront and API on different sites, with `SameSite=None` cookies. Since ADR 0014,
   though, the storefront reads the session cookie itself: `proxy.ts` checks for it, and Server
   Components forward it to `/me`. A browser never sends the API's cookie to an unrelated storefront
   host. So sign-in would succeed, and every protected page would send the customer back to sign-in.
2. **The API would not start from a production install.** `src/config/env.ts` imports
   `dotenv/config`, but `dotenv` was a dev dependency, which `npm ci --omit=dev` leaves out.
3. **CI would fail on its first Linux run.** The frontend lockfile, written on Windows, lacked
   Linux-only optional packages (`@emnapi/*`), so `npm ci` refuses it. The committed lockfile had the
   same gap; the first Linux image build found it.

## Decision
1. **Production is same-site, enforced at boot.** Either one origin, with the edge routing `/api/*`
   to the API (preferred, and what the rehearsal does), or sibling subdomains with
   `AUTH_COOKIE_DOMAIN` set to their parent. The session cookie is `SameSite=Lax` in every
   environment, which is stricter than `None`. `src/config/deployment.ts` refuses any other
   production shape, and also plain http except on loopback; `tests/deployment.test.ts` covers it.
   The payment return needs no cookie (it answers the provider's POST with a 303), so Lax does not
   affect payments.
2. **`API_INTERNAL_URL`** (storefront, server-only, optional) lets Server Components reach the API
   over the private network instead of through the public edge.
3. **Three images.** `backend/Dockerfile` builds one runtime image for the API
   (`node dist/server.js`) and the worker (`node dist/worker.js`), plus a `migrate` target that runs
   `prisma migrate deploy` once per release. `frontend/Dockerfile` builds Next's standalone output.
   Images run as non-root, carry no secrets, and have healthchecks. The storefront image bakes in its
   `NEXT_PUBLIC_*` URLs, so it is built per environment.
4. **A staging rehearsal in the repository** (`deploy/staging/`): the three images with
   `NODE_ENV=production`, behind Caddy at one origin, with PostgreSQL, an S3-compatible store
   (SeaweedFS; MinIO no longer publishes images), and Mailpit as an SMTP relay that requires
   STARTTLS. Mailpit's certificate comes from a throwaway local CA, trusted through
   `NODE_EXTRA_CA_CERTS`; no TLS check is relaxed in code. `setup.sh` generates every secret; none is
   committed.
5. **Tooling that runs against any environment:** `deploy/smoke/smoke.mjs` (read-only by default;
   `--account` signs up a throwaway customer and checks that the session reaches both the API and
   the storefront), `deploy/load/load-test.mjs` (the defined load test, [load-test.md](../load-test.md))
   and `deploy/backup/restore-drill.sh`.
6. **Runbooks** for deploying ([runbooks/deploy.md](../runbooks/deploy.md): expand-only migrations,
   forward-fix, failed-migration recovery), backup and restore, monitoring and alerts, and incident
   response. The gates and their owners are in [launch-gates.md](../launch-gates.md).
7. **Storefront hardening headers:** `X-Content-Type-Options`, `Referrer-Policy`,
   `X-Frame-Options: DENY` and `Permissions-Policy`, and no `X-Powered-By`. HSTS belongs to the TLS edge.

## What the rehearsal proved (2026-11-14, one laptop)
- The production images boot with `NODE_ENV=production`, migrate, and serve at one origin.
- The smoke test passes 16/16, including the check that a session reaches a protected storefront page.
- Restoring a backup taken before this release and running the migrate job brings it forward (16 → 17
  migrations).
- The outbox worker delivers email over STARTTLS with certificate verification.
- The same API image refuses to boot with a cross-site configuration, and names the fix.
- A restore drill passes at 1.2M rows (restore in 33 s), and the load test measured the rehearsal
  ([load-test.md](../load-test.md)).

## Consequences
- **A layout with the storefront and API on unrelated domains is no longer possible.** That is
  deliberate: it never worked once ADR 0014 landed.
- CORS and `trustedOrigins` stay: harmless at one origin, and still needed for sibling subdomains.
- There is still no Content-Security-Policy. Next's inline bootstrap scripts need per-request nonces,
  which means rendering every page dynamically, and that conflicts with the static shells
  `cacheComponents` builds. It deserves its own decision.

## Not done (needs a decision or an outside party)
Choosing hosting and deploying real staging; a managed point-in-time restore drill on that provider;
wiring the alerts into a tool; agreeing the RPO/RTO, SLO and load profile; a live SSLCOMMERZ store;
an email provider with SPF, DKIM and DMARC; and the legal, tax and policy gates in launch-gates.md.

## Alternatives
- **Keep cross-site and stop reading the cookie in the storefront** (drop `proxy.ts` and server-side
  session reads). That would undo ADR 0014's guarded pages and server-rendered account data, and
  keep `SameSite=None` CSRF exposure. Rejected.
- **Bearer tokens instead of cookies:** ADR 0006 already rejected them for XSS exposure.
- **Kubernetes manifests or a provider template now:** premature before hosting is chosen; the
  images and environment are what carry over to any platform.

## Revisit when
Hosting is chosen (add its deployment config next to `deploy/staging/`); traffic needs more than
two API instances (move rate limiting to a shared store, ADR 0009); or a CSP becomes required.
