-- =====================================================================
-- Migration 027 - Per-page Vault folder + "Hide from AI" flag
-- Foundation for AI media access:
--   1. Each page links to its own Vault folder (the AI agent's media scope).
--      ON DELETE SET NULL — deleting the folder just unlinks the page; deleting a
--      page leaves the folder in the vault (also an "unlink", per the agreed rule).
--   2. Per-file "Hide from AI" flag — default 0 (visible); 1 hides the file from the
--      AI's media search and shows it with a distinct card in the Vault UI.
-- Run once. Additive — safe.
-- =====================================================================

ALTER TABLE platform_accounts
  ADD COLUMN vault_folder_id INT NULL,
  ADD CONSTRAINT fk_accounts_vault_folder FOREIGN KEY (vault_folder_id) REFERENCES vault_items(id) ON DELETE SET NULL;

ALTER TABLE vault_items
  ADD COLUMN ai_hidden TINYINT(1) NOT NULL DEFAULT 0; -- 0 = visible to AI (default), 1 = hidden
