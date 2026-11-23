# CommerceCore — Defined load test (M12)

- **Date:** 2026-11-14
- **Tool:** `deploy/load/load-test.mjs`, no dependencies, repeatable against any environment.
- **Target:** the staging rehearsal (`deploy/staging/`): production images with `NODE_ENV=production`
  behind one origin, holding a restored copy of the development catalog (2,744 products, 9,637
  variants, 2,748 images in S3).
- **Hardware:** one development laptop running Docker Desktop (12 logical CPUs shared by the
  generator, every container and unrelated workloads), one instance of each service. **These are
  rehearsal numbers, not production capacity.** Repeat on staging hardware before quoting any.

## Profile (proposed — PRD §9 has not set one)

| | Proposal |
|---|---|
| Peak | **50 concurrent active shoppers**, which is a busy evening for a single fashion store |
| Request rate | about one request every 5 s per browsing shopper (page, then its API reads), so **~10 requests/s** at peak |
| Mix | browsing: listing 25%, filtered/price-sorted listing 10%, facets 10%, search 10%, product API 15%, product page (server-rendered) 15%, shop page 10%, home 5% |
| SLO at peak | p95 < 500 ms for API reads, < 1.5 s for pages, errors < 0.5% |

Checkout is not in the mix: every write is rate limited per client IP (ADR 0009) and a generator is
one IP. Its correctness under concurrency is proven by the integration suite (final-unit races,
duplicate submissions, coupon limits), not by load.

## Results

**Open loop** (requests arrive at a fixed rate, as independent shoppers do; 30 s per stage):

| Rate (req/s) | p50 ms | p95 ms | p99 ms | Errors |
|---:|---:|---:|---:|---:|
| 5 | 19 | 62 | 71 | 0% |
| **10** (the proposed peak) | **29** | **91** | 129 | 0% |
| 15 | 359 | 3,849 | 5,395 | 0% |
| 20 | 964 | 6,467 | 11,519 | 0% |
| 30 | 2,603 | 15,500 | 18,898 | 0% |

**Closed loop** (N shoppers with no think time, so this is saturation): throughput levels off at
**~40 requests/s** from 10 shoppers on; latency then grows with concurrency (p95 0.8 s at 10, 2.8 s
at 25, 5.9 s at 50, 12.7 s at 100). No request failed at any stage.

**So:** the SLO holds at the proposed peak, with p95 91 ms at 10 req/s, but the knee is between 10 and
15 req/s. That is too little headroom to launch on hardware like this; see what bounds it below.

## What bounds it

Measured one endpoint at a time, with container CPU sampled during the run:

| Endpoint alone, 20 concurrent | req/s | Saturated |
|---|---:|---|
| `/api/v1/livez` (no database) | 398 | Caddy and the API process: the request path's ceiling |
| `/api/v1/products/:slug` | 141 | the API process (~100% of one core, Node is single-threaded) |
| `/shop` (static shell) | 126 | the storefront process |
| `/api/v1/products` (default listing) | 96 | **PostgreSQL (~400% CPU)**: the total count scans the catalog on every request |
| `/products/:slug` (server-rendered) | 17 | **the storefront process (~130% CPU)**: rendering, plus two API calls per page |

Uncontended cost per call on this data: facets 63 ms (five whole-catalog aggregates), search 62 ms,
price-sorted listing 48 ms, default listing 25 ms, product detail 9 ms.

1. **Whole-catalog aggregates in PostgreSQL:** listing counts, facets, search and price sorts. Their
   results are the same for every anonymous visitor using the same filters. A short-lived cache
   (30–60 s) for counts and facets would remove most of this load. It changes the cache policy, so it
   needs a decision first ([ADR 0005](decisions/0005-cache-policy.md)); docs/performance-review.md has
   the index-level options.
2. **Server rendering in one Node process:** product pages at ~17 req/s per storefront instance. Run
   two or more storefront instances; they are stateless.
3. **One API process:** add instances, but ADR 0009's per-instance rate limits must move to a shared
   store beyond two.

## Found while measuring

- **A restored database plans blind until analyzed.** Without fresh planner statistics after the
  restore, the default listing served 44 req/s; after `ANALYZE`, 96. The drill script and the restore
  runbook now run it.
- No request failed at any stage, including 30 s queues: nothing timed out inside the stack, and the
  connection pool did not run dry.

## Re-running it

```bash
node deploy/load/load-test.mjs http://localhost:8080                              # closed loop
RATES=5,10,15,20 STAGE_SECONDS=60 node deploy/load/load-test.mjs https://staging.example.com
LOAD_OUT=results.json …                                                            # keep the numbers
```

Run the generator on a different machine from the target when measuring real staging, and never run
it against production without warning whoever is on call.
