-- CreateEnum
CREATE TYPE "OutboxEventType" AS ENUM ('ORDER_RECEIPT', 'SHIPPING_UPDATE', 'LOW_STOCK_ALERT');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DEAD');

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "event_type" "OutboxEventType" NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_role" "UserRole",
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before_data" JSONB,
    "after_data" JSONB,
    "ip_address" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_dedupe_key_key" ON "outbox_events"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_events_status_next_attempt_at_idx" ON "outbox_events"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ===========================================================================
-- HAND-WRITTEN CONSTRAINTS — see the review rule in 20261021120000_identity.
-- ===========================================================================

-- --- OutboxEvent -----------------------------------------------------------
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_attempt_count_check" CHECK ("attempt_count" >= 0);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_sent_timestamp_check" CHECK ("status" <> 'SENT' OR "processed_at" IS NOT NULL);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_dedupe_key_not_blank_check" CHECK (char_length(btrim("dedupe_key")) > 0);

-- --- AuditLog --------------------------------------------------------------
-- Every audited action is attributable to a user or explicitly to the system; an
-- unattributed entry would defeat the point of the log (PRD §6 rule 8).
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_check" CHECK ("actor_user_id" IS NOT NULL OR "is_system");
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_action_not_blank_check" CHECK (char_length(btrim("action")) > 0 AND char_length(btrim("entity_type")) > 0);
