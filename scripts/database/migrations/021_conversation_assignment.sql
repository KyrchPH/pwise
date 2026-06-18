-- =====================================================================
-- Migration 021 — conversation ownership + transfers
-- A Live Agent conversation is now bound to one user (assigned_user_id): only that
-- user can view/reply to it. Ownership moves between users via a transfer that the
-- recipient must accept. Run ONCE (MariaDB 10.6). Additive — safe.
-- (FKs are enforced in the app, omitted here to keep the migration idempotent;
--  fresh installs via schema.sql declare them.)
-- =====================================================================

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_user_id   INT NULL          AFTER handled_by,
  ADD COLUMN IF NOT EXISTS assigned_user_name VARCHAR(255) NULL AFTER assigned_user_id;

CREATE TABLE IF NOT EXISTS conversation_transfers (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  from_user_id    INT NULL,
  from_user_name  VARCHAR(255),
  to_user_id      INT NOT NULL,
  to_user_name    VARCHAR(255),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | accepted | declined | cancelled
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at    DATETIME NULL,
  INDEX idx_transfer_to_pending (to_user_id, status),
  INDEX idx_transfer_conversation (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
