# ADR 0003 — Verified Webhooks and Idempotent Payment Processing
- **Status:** Accepted
- **Date:** 2026-10-21
- **Context:** Providers retry events, events may arrive out of order, and payment may complete after the customer closes the browser.
- **Decision:** Verify provider signatures, deduplicate `(provider,eventId)`, apply idempotent conditional state transitions and reconcile ambiguous outcomes. A redirect alone never marks payment successful.
- **Consequences:** Requires webhook event persistence, unique constraint, safe retry and reconciliation path; provider-specific signature/acknowledgement rules must be followed.
- **Alternatives:** Trust redirect or process every webhook as a new command.
