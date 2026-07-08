-- =====================================================================
-- Migration 053 — login & security hardening
-- Adds:
--   * users.failed_login_attempts + users.locked_until — brute-force lockout
--     (5 wrong passwords → locked 30 min; lazy auto-unlock; admin can clear it).
--   * auth_otp_codes — generic one-time email codes for sensitive auth actions
--     (purpose='login' new-device OTP, 'email_change' email-change OTP).
--   * trusted_devices — browsers the user chose to trust so future logins skip
--     the OTP (server stores only SHA-256 of a high-entropy secret; sliding 30-day
--     expiry). A trusted device bypasses the OTP only, never the password.
-- Run ONCE against the `pwise` database (paste into MySQL Workbench, or pipe
-- through the mysql client). Standard MySQL 8.0 syntax.
-- =====================================================================

ALTER TABLE users
  ADD COLUMN failed_login_attempts INT NOT NULL DEFAULT 0 AFTER is_active,
  ADD COLUMN locked_until DATETIME NULL AFTER failed_login_attempts;

CREATE TABLE IF NOT EXISTS auth_otp_codes (
  user_id    INT NOT NULL,
  purpose    VARCHAR(20) NOT NULL,
  code_hash  VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  verified   BOOLEAN NOT NULL DEFAULT FALSE,
  attempts   INT NOT NULL DEFAULT 0,
  payload    JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, purpose),
  CONSTRAINT fk_otp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS trusted_devices (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  token_hash   CHAR(64) NOT NULL,
  label        VARCHAR(255) NULL,
  ip           VARCHAR(64) NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  expires_at   DATETIME NOT NULL,
  revoked_at   DATETIME NULL,
  UNIQUE KEY uq_trusted_devices_token (token_hash),
  CONSTRAINT fk_trusted_devices_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_trusted_devices_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
