# ADR 0001 — Modular Monolith
- **Status:** Accepted; deployment topology amended by [ADR 0006](0006-separate-frontend-backend-express-better-auth.md)
- **Date:** 2026-10-21
- **Context:** CommerceCore is a single-store application with related catalog, cart, inventory, order and payment workflows, initially maintained by a small team/individual.
- **Decision:** Start as one deployable application with explicit domain modules and a shared PostgreSQL database.
- **Consequences:** Simpler development/deployment and transactional workflows; requires discipline to prevent cross-module shortcuts; independent scaling/deployment is limited.
- **Alternatives:** Microservices or separate frontend/backend deployments from day one. The separate frontend/backend option was later adopted by ADR 0006; the modular-monolith internals and single shared database decided here still apply to the backend.
- **Revisit when:** Measured scaling, isolation, or team ownership justifies distributed-system overhead.
