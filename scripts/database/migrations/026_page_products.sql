-- =====================================================================
-- Migration 026 — page_products (per-page product catalog)
-- A list of products attached to each connected page (account). Shared like the
-- rest of the app's data. The photo is stored as a STABLE S3 key (resolved from a
-- Vault item picked in the UI) — never a presigned URL, since those expire; the API
-- presigns `photo_url` fresh on read. Run ONCE (MariaDB 10.6). Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS page_products (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  account_id  INT NOT NULL,
  name        VARCHAR(255) NOT NULL,
  base_price  DECIMAL(12, 2) NULL,
  description TEXT NULL,
  category    VARCHAR(120) NULL,
  tags        JSON NULL,
  photo_key   VARCHAR(512) NULL,                -- S3 key of the product photo (stable)
  created_by  INT NULL,
  updated_by  INT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_page_products_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_page_products_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_page_products_editor  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_page_products_account (account_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
