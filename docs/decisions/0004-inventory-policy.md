# ADR 0004 — Inventory Consistency Policy
- **Status:** Proposed — decision required before checkout implementation
- **Date:** 2026-10-21
- **Context:** Concurrent checkout must not purchase the same final unit; online payment can remain pending.
- **Options:** (1) Atomic decrement during order creation, simpler but requires release/compensation on failed/abandoned payment. (2) Timed reservation, requires expiry worker, release/consume transitions and late-payment reconciliation.
- **Recommendation:** Start with atomic conditional stock writes if scope is constrained; enable reservations only after expiry and late-success behavior are fully defined.
- **Owner:** Project owner.
- **Required follow-up:** Choose policy and update architecture, schema, tests and state diagrams.
