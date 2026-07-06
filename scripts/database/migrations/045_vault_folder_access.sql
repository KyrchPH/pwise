-- =====================================================================
-- Migration 045 - Vault folder access control (public/private folders)
-- Folders gain a `visibility`: 'public' (default, no restriction — the prior
-- behaviour) or 'private'. A private folder — and everything inside it — is
-- visible/accessible ONLY to admins and the users on its allow-list
-- (vault_folder_access). Only admins can set/manage a folder's restriction.
-- Files have no visibility of their own; they inherit their folder's.
-- Run once. Additive — safe.
-- =====================================================================

ALTER TABLE vault_items
  ADD COLUMN visibility VARCHAR(10) NOT NULL DEFAULT 'public'; -- 'public' | 'private' (folders)

-- Allow-list for private folders: which users may see/enter a private folder.
-- Admins always have access (not stored here). Rows cascade away with the folder
-- or the user.
CREATE TABLE IF NOT EXISTS vault_folder_access (
  folder_id INT NOT NULL,
  user_id   INT NOT NULL,
  PRIMARY KEY (folder_id, user_id),
  CONSTRAINT fk_vfa_folder FOREIGN KEY (folder_id) REFERENCES vault_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_vfa_user   FOREIGN KEY (user_id)   REFERENCES users(id)       ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
