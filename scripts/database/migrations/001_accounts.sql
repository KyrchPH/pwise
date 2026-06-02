-- =====================================================================
-- Migration 001 — invite-only accounts (roles, status, invites)
-- Standard MySQL/MariaDB syntax. Run ONCE against the `pwise` database.
-- Apply with: npm run db:migrate:accounts  (or paste into MySQL Workbench)
-- =====================================================================

ALTER TABLE users
  ADD COLUMN role       VARCHAR(20) NOT NULL DEFAULT 'user',
  ADD COLUMN is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN deleted_at DATETIME    NULL;

CREATE TABLE IF NOT EXISTS invites (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  token       VARCHAR(64) NOT NULL,
  created_by  INT NOT NULL,
  used_by     INT NULL,
  used_at     DATETIME NULL,
  expires_at  DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_invites_token (token),
  CONSTRAINT fk_invites_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_invites_user FOREIGN KEY (used_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_invites_creator (created_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
