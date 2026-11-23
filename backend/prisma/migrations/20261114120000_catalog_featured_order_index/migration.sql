-- The storefront's default listing order (`featured`): featured_rank ASC NULLS LAST, then
-- newest. The single-column index covered only the first key, so PostgreSQL sorted every
-- published product (nearly all have no rank) to return one page. This index matches the
-- whole ORDER BY, so a page is read in order and the scan stops after it.
-- It also serves the dark-edit query (featured_rank IS NOT NULL ORDER BY featured_rank), so
-- the old index is redundant. Dropping an index removes no data.
CREATE INDEX "products_featured_rank_published_at_created_at_id_idx"
  ON "products"("featured_rank", "published_at" DESC, "created_at" DESC, "id" DESC);

DROP INDEX "products_featured_rank_idx";
