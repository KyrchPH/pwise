-- =====================================================================
-- Migration 033 - Creatomate render jobs (async render flow)
-- "Generate with Template" no longer blocks the HTTP request waiting for Creatomate.
-- startRender creates a row here (status 'rendering') and returns its id immediately;
-- n8n's render-complete webhook POSTs back to /api/creatomate-templates/renders/callback,
-- which fills in the result; the composer polls GET /renders/:id until it's done.
-- Run once. Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS creatomate_renders (
  id            CHAR(36) PRIMARY KEY,                       -- uuid job id (correlation key passed to n8n → Creatomate metadata)
  user_id       INT NULL,
  template_id   INT NULL,
  status        VARCHAR(16) NOT NULL DEFAULT 'rendering',   -- rendering | succeeded | failed
  video_url     TEXT NULL,
  snapshot_url  TEXT NULL,
  error_message TEXT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_creatomate_renders_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
