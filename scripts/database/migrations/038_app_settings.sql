-- =====================================================================
-- Migration 038 - Global app settings (key/value)
-- A tiny shared store for app-wide flags that must be toggleable at RUNTIME (no
-- restart), unlike the env-only feature flags. First use: the admin "pause" switches
-- that stop the AI Agent from auto-replying and/or stop auto-posting. `value` is a
-- small string ('1'/'0' for booleans); add keys freely as more global flags appear.
-- Run once. Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(64) PRIMARY KEY,
  value       VARCHAR(255) NOT NULL,
  updated_by  INT NULL,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
