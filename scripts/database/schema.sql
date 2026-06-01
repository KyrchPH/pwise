-- =====================================================================
-- Auto Post Agent — database schema (MySQL 8.0+)
-- Idempotent: safe to run multiple times. Apply with `npm run db:migrate`.
--
-- Notes / deviations from the original plan:
--   * Engine InnoDB, charset utf8mb4 — captions contain emojis, and utf8mb4
--     is required to store 4-byte characters.
--   * Timestamps are DATETIME storing UTC (the app converts to each user's
--     `timezone`). created_at/updated_at use DEFAULT CURRENT_TIMESTAMP +
--     ON UPDATE CURRENT_TIMESTAMP, so MySQL maintains updated_at natively
--     (no trigger needed). Wall-clock posting windows stay as TIME.
--   * status / media_type use CHECK constraints (enforced on MySQL 8.0.16+).
--   * Foreign keys are table-level — MySQL silently ignores inline column
--     REFERENCES, so they must be declared as constraints.
--   * posting_settings.user_id is UNIQUE (one settings row per user); the
--     post_pool index matches the scheduler's claim query.
-- =====================================================================

-- users — account information -------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- post_pool — uploaded post content (the pool the agent draws from) ------
CREATE TABLE IF NOT EXISTS post_pool (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  caption         TEXT,
  media_type      VARCHAR(50),
  media_url       TEXT,
  s3_key          TEXT,
  target_platform VARCHAR(100),
  status          VARCHAR(50) NOT NULL DEFAULT 'draft',
  priority        INT NOT NULL DEFAULT 0,
  scheduled_at    DATETIME NULL,
  posted_at       DATETIME NULL,
  failed_reason   TEXT,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_post_pool_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_post_pool_status
    CHECK (status IN ('draft','ready','posting','posted','failed','archived')),
  CONSTRAINT chk_post_pool_media_type
    CHECK (media_type IS NULL OR media_type IN ('image','video')),
  -- Supports the scheduler claim query:
  --   WHERE user_id = ? AND status = 'ready'
  --   ORDER BY priority DESC, created_at ASC  ... FOR UPDATE SKIP LOCKED LIMIT 1
  INDEX idx_post_pool_claim (user_id, status, priority DESC, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- posting_settings — automation config (exactly one row per user) --------
CREATE TABLE IF NOT EXISTS posting_settings (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  user_id                  INT NOT NULL,
  is_enabled               BOOLEAN NOT NULL DEFAULT FALSE,
  posting_interval_minutes INT NOT NULL DEFAULT 360,
  allowed_start_time       TIME NOT NULL DEFAULT '09:00:00',
  allowed_end_time         TIME NOT NULL DEFAULT '21:00:00',
  timezone                 VARCHAR(100) NOT NULL DEFAULT 'Asia/Manila',
  low_pool_alert_threshold INT NOT NULL DEFAULT 3,
  owner_email              VARCHAR(255),
  last_alert_sent_at       DATETIME NULL,
  created_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_posting_settings_user (user_id),
  CONSTRAINT fk_posting_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- posting_logs — every posting attempt (append-only; no updated_at) ------
CREATE TABLE IF NOT EXISTS posting_logs (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NOT NULL,
  post_id          INT NULL,
  target_platform  VARCHAR(100),
  status           VARCHAR(50),
  response_message TEXT,
  error_message    TEXT,
  posted_at        DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_posting_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_posting_logs_post FOREIGN KEY (post_id) REFERENCES post_pool(id) ON DELETE SET NULL,
  INDEX idx_posting_logs_user (user_id, created_at DESC),
  INDEX idx_posting_logs_post (post_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- platform_accounts — connected posting channels ------------------------
-- Tokens MUST be encrypted before being written here (see Security in plan).
CREATE TABLE IF NOT EXISTS platform_accounts (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  user_id          INT NOT NULL,
  platform_name    VARCHAR(100) NOT NULL,
  account_name     VARCHAR(255),
  access_token     TEXT,
  refresh_token    TEXT,
  token_expires_at DATETIME NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_platform_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_platform_accounts_user (user_id, platform_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
