-- M9 (ADR 0021): the outbox worker.
-- Additive: no existing row or constraint is touched. Nothing processed the outbox before this
-- migration, so no row is in PROCESSING and the new CHECK holds for every existing row.

-- The payment and refund sweep becomes a recurring job in the same table, so one worker runs it
-- at a time and its failures are visible next to the emails'.
ALTER TYPE "OutboxEventType" ADD VALUE 'PAYMENT_RECONCILIATION';

-- Set when a worker claims a row and cleared when it records the outcome. The outcome is written
-- only while the token still matches, so a worker whose lease ran out cannot overwrite the result
-- of the worker that took the row over.
ALTER TABLE "outbox_events" ADD COLUMN "claim_token" TEXT;

-- ===========================================================================
-- HAND-WRITTEN CONSTRAINTS — see the review rule in 20261021120000_identity.
-- ===========================================================================

-- A claimed row always names its claim, and only a claimed row does.
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_claim_token_check"
  CHECK (("status" = 'PROCESSING') = ("claim_token" IS NOT NULL));

-- The worker stores a shortened, redacted message; a provider's whole response is not wanted here.
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_last_error_length_check"
  CHECK ("last_error" IS NULL OR char_length("last_error") <= 1000);
