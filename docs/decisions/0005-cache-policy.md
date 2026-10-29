# ADR 0005 — Defer Redis Until Needed
- **Status:** Accepted
- **Date:** 2026-10-21
- **Context:** Initial catalog reads can use PostgreSQL indexes and framework/CDN caching for safe public data.
- **Decision:** Redis is not required initially. Add it only for a demonstrated cache, queue or rate-limit requirement and document failure behavior.
- **Consequences:** Lower operational complexity; cache invalidation still needs deliberate handling; personalized data and checkout-authoritative price/stock must not use unsafe stale cache.
- **Revisit when:** Load tests show current capabilities are insufficient.
