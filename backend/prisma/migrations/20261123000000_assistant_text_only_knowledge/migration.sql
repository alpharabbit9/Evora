-- Groq-only assistant (ADR 0025, amendment of 2026-11-23). Without an embedding provider the
-- policy chunks are stored as text alone and found by full-text search, so their vector may be
-- empty. Product embeddings stay required: without a provider they are simply not written.
-- Nothing is removed; existing rows keep their vectors until the next index run rewrites them.
ALTER TABLE "knowledge_chunks" ALTER COLUMN "embedding" DROP NOT NULL;
