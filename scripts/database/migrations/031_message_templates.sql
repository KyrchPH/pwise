-- =====================================================================
-- Migration 031 - Per-page message templates
-- Reusable canned replies, scoped per connected page. Each page's set is seeded
-- from the built-in defaults on first access (server: message_templates.service.js)
-- and is then fully editable (create / edit / duplicate / delete) from the Messaging
-- → Templates section. tags is a JSON array; sort_order keeps a stable display order.
-- Deleting a page removes its templates (FK CASCADE).
-- Run once. Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS message_templates (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  account_id  INT NOT NULL,
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL,
  tags        JSON NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_message_templates_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
  INDEX idx_message_templates_account (account_id, sort_order, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
