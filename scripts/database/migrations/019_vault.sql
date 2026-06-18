-- =====================================================================
-- Migration 019 - Vault (shared file manager)
-- A global file tree: folders and files in one self-referencing table. Files
-- carry an S3 key (+ optional thumbnail key for images/videos). Shared like the
-- rest of the app — every signed-in user sees/edits all items; user_id records
-- the uploader (audit). Deleting a folder cascades to its descendants (and the
-- app deletes their S3 objects first). Run once. Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS vault_items (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  parent_id        INT NULL,                       -- NULL = root ("Main")
  type             VARCHAR(10) NOT NULL,           -- 'folder' | 'file'
  name             VARCHAR(255) NOT NULL,
  media_type       VARCHAR(20),                    -- 'image' | 'video' | 'file' (files only)
  mime_type        VARCHAR(150),
  s3_key           TEXT,                           -- files only
  thumbnail_s3_key TEXT,                           -- optimized still (images/videos)
  size             BIGINT NOT NULL DEFAULT 0,
  user_id          INT NULL,                       -- uploader (audit)
  uploaded_by      VARCHAR(255),                   -- snapshot name for durable display
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_vault_parent FOREIGN KEY (parent_id) REFERENCES vault_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_vault_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_vault_type CHECK (type IN ('folder', 'file')),
  INDEX idx_vault_parent (parent_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
