-- Corrects `products_source_identity_check` from 20261027120000_catalog_import_provenance.
--
-- The original second branch was `char_length(btrim(a)) > 0 AND char_length(btrim(b)) > 0`.
-- With one column NULL that evaluates to NULL, not FALSE, and a CHECK only rejects FALSE — so a
-- half-set identity was accepted. Caught by tests/db/constraints.test.ts before any data used
-- the columns. Rewritten with explicit IS NOT NULL so every branch is TRUE or FALSE.
ALTER TABLE "products" DROP CONSTRAINT "products_source_identity_check";

ALTER TABLE "products" ADD CONSTRAINT "products_source_identity_check" CHECK (
  ("source_provider" IS NULL AND "source_external_id" IS NULL)
  OR (
    "source_provider" IS NOT NULL AND "source_external_id" IS NOT NULL
    AND char_length(btrim("source_provider")) > 0
    AND char_length(btrim("source_external_id")) > 0
  )
);
