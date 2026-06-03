-- =====================================================================
-- Migration 004 — post activity audit log
-- Records who CREATED / EDITED / DELETED each post. The post pool is now a
-- shared pool (every user sees every post); this table is how we identify who
-- took an action. user_id/post_id are SET NULL on delete so the audit row
-- survives, and user_name is a snapshot so the actor is identifiable even if
-- the account is later removed.
-- Run ONCE against the `pwise` database (MySQL 8.0).
-- =====================================================================

CREATE TABLE IF NOT EXISTS post_activity_log (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  post_id    INT NULL,
  user_id    INT NULL,
  user_name  VARCHAR(255),
  action     VARCHAR(20) NOT NULL,
  details    TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_activity_post FOREIGN KEY (post_id) REFERENCES post_pool(id) ON DELETE SET NULL,
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_activity_action CHECK (action IN ('created','edited','deleted')),
  INDEX idx_activity_created (created_at DESC),
  INDEX idx_activity_post (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
