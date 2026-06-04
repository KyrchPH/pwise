-- =====================================================================
-- Migration 011 — Creatomate template library (Settings)
-- Stores reusable Creatomate render configs (template_id + modifications) as
-- JSON. Added/edited from Settings; consumed later by the video-generation flow.
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS creatomate_templates (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  config      LONGTEXT NOT NULL,          -- the Creatomate template JSON
  user_id     INT NULL,                   -- creator (audit)
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_creatomate_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
