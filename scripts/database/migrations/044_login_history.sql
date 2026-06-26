-- =====================================================================
-- Migration 044 - Login sessions (history + per-device revocation)
-- Each successful login is recorded here = a revocable "session". The JWT carries this
-- row's id (sid); requireAuth rejects a token whose session row is missing or has
-- revoked_at set — that's how "log out of this device" / "all other devices" work. The
-- same rows power the Profile -> Security session/login-history list. last_seen_at is
-- bumped (throttled) on activity. Deleting a user removes their rows.
--
-- Idempotent + self-healing: safe to re-run. CREATE handles a fresh DB; the guarded
-- ADD COLUMNs below repair a table left behind by an EARLIER version of this migration
-- that predates last_seen_at/revoked_at (CREATE TABLE IF NOT EXISTS alone can't add
-- columns to a table that already exists, which is what caused login to 500 with
-- "Unknown column 'last_seen_at'"). Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS login_history (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  ip           VARCHAR(64) NULL,
  user_agent   VARCHAR(512) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NULL,
  revoked_at   DATETIME NULL,
  CONSTRAINT fk_login_history_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_login_history_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add any column missing from a pre-existing table (no-op when already present).
SET @sql := IF(
  NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_history' AND COLUMN_NAME = 'created_at'),
  'ALTER TABLE login_history ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_history' AND COLUMN_NAME = 'last_seen_at'),
  'ALTER TABLE login_history ADD COLUMN last_seen_at DATETIME NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @sql := IF(
  NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'login_history' AND COLUMN_NAME = 'revoked_at'),
  'ALTER TABLE login_history ADD COLUMN revoked_at DATETIME NULL',
  'DO 0');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
