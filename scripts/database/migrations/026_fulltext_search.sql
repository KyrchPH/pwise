-- =====================================================================
-- Migration 026 - Per-page catalog + FULLTEXT search for the AI agent
-- Two things, so each page's AI agent searches ONLY its own items:
--   1. Scope products + reference answers to a page via account_id (mirrors the
--      per-page vault folder). ON DELETE SET NULL — removing a page leaves its
--      rows in place but unlinked (and thus invisible to every page's search).
--   2. Add the FULLTEXT indexes the `search_catalog` tool queries
--      (POST /api/messages/knowledge → MATCH(...) AGAINST(...)). No embeddings.
--
-- These two tables are managed outside the repo (added directly in MySQL), so
-- this only ALTERs them. InnoDB / MySQL 8.0. Run once (re-running errors).
-- NOTE: the FULLTEXT index is added in its own statement — InnoDB can't create
-- the first FULLTEXT index in the same ALTER as other changes.
-- =====================================================================

ALTER TABLE products
  ADD COLUMN account_id INT NULL,
  ADD CONSTRAINT fk_products_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE SET NULL,
  ADD INDEX idx_products_account (account_id);
ALTER TABLE products
  ADD FULLTEXT INDEX ft_products_search (name, category, description);

ALTER TABLE ai_agent_reference
  ADD COLUMN account_id INT NULL,
  ADD CONSTRAINT fk_reference_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE SET NULL,
  ADD INDEX idx_reference_account (account_id);
ALTER TABLE ai_agent_reference
  ADD FULLTEXT INDEX ft_reference_search (question, answer);

-- BACKFILL (REQUIRED): assign existing rows to their page. Until you run this,
-- existing rows have account_id = NULL and the scoped search returns nothing.
-- Replace 1 with the page's account_id (platform_accounts.id):
--   UPDATE products SET account_id = 1 WHERE account_id IS NULL;
--   UPDATE ai_agent_reference SET account_id = 1 WHERE account_id IS NULL;
