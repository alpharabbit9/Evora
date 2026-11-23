-- M13 (ADR 0025): the shopping assistant.
-- Additive: no existing row, column or constraint is touched.

-- pgvector supplies the `vector` type and the HNSW index. Installing it needs the extension files on
-- the server (docs/assistant-setup.md); CI and staging use the pgvector/pgvector image.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('DRAFT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "AssistantRole" AS ENUM ('USER', 'ASSISTANT');

-- AlterEnum


ALTER TYPE "OutboxEventType" ADD VALUE 'ASSISTANT_INDEX_SWEEP';
ALTER TYPE "OutboxEventType" ADD VALUE 'ASSISTANT_RETENTION';

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'DRAFT',
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "heading" TEXT,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_embeddings" (
    "product_id" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "embedded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_embeddings_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "assistant_conversations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "guest_token_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "assistant_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "AssistantRole" NOT NULL,
    "content" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "tool_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "latency_ms" INTEGER,
    "error_code" TEXT,
    "client_key_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_slug_key" ON "knowledge_documents"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_document_id_ordinal_key" ON "knowledge_chunks"("document_id", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_conversations_guest_token_hash_key" ON "assistant_conversations"("guest_token_hash");

-- CreateIndex
CREATE INDEX "assistant_conversations_user_id_last_message_at_idx" ON "assistant_conversations"("user_id", "last_message_at" DESC);

-- CreateIndex
CREATE INDEX "assistant_conversations_last_message_at_idx" ON "assistant_conversations"("last_message_at");

-- CreateIndex
CREATE INDEX "assistant_messages_conversation_id_created_at_idx" ON "assistant_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_messages_client_key_hash_created_at_idx" ON "assistant_messages"("client_key_hash", "created_at");

-- CreateIndex
CREATE INDEX "assistant_messages_created_at_idx" ON "assistant_messages"("created_at");

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_embeddings" ADD CONSTRAINT "product_embeddings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "assistant_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- HAND-WRITTEN CONSTRAINTS AND INDEXES — see the review rule in 20261021120000_identity.
-- Prisma does not model CHECKs or HNSW indexes; tests/db/constraints.test.ts asserts each one.
-- ===========================================================================

ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_slug_check"
  CHECK (char_length("slug") BETWEEN 1 AND 100);
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_title_check"
  CHECK (char_length("title") BETWEEN 1 AND 200);
-- A store path the widget can link to, never another site.
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_path_check"
  CHECK ("path" LIKE '/%' AND "path" NOT LIKE '//%');

ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_ordinal_check"
  CHECK ("ordinal" >= 0);
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_content_length_check"
  CHECK (char_length("content") BETWEEN 1 AND 4000);

-- Exactly one owner: a customer, or a guest's token hash.
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_owner_check"
  CHECK (("user_id" IS NULL) <> ("guest_token_hash" IS NULL));
ALTER TABLE "assistant_conversations" ADD CONSTRAINT "assistant_conversations_message_count_check"
  CHECK ("message_count" >= 0);

ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_content_length_check"
  CHECK (char_length("content") <= 8000 AND ("role" <> 'USER' OR char_length("content") BETWEEN 1 AND 1000));
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_tokens_check"
  CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0);
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_latency_check"
  CHECK ("latency_ms" IS NULL OR "latency_ms" >= 0);
ALTER TABLE "assistant_messages" ADD CONSTRAINT "assistant_messages_error_code_length_check"
  CHECK ("error_code" IS NULL OR char_length("error_code") BETWEEN 1 AND 64);

-- Nearest-neighbour search by cosine distance (`<=>`). HNSW needs no training data, so it works on
-- an empty table and keeps working as rows arrive. Default build parameters (m 16, ef_construction 64).
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx"
  ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);
CREATE INDEX "product_embeddings_embedding_hnsw_idx"
  ON "product_embeddings" USING hnsw ("embedding" vector_cosine_ops);
