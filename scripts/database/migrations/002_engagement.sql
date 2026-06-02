-- =====================================================================
-- Migration 002 — post engagement
-- Adds the published post's platform ID plus reaction/comment/share/view
-- counts that the n8n engagement-sync flow pulls back from the platform.
-- Run ONCE against the `pwise` database (paste into MySQL Workbench, or pipe
-- through the mysql client). Standard MySQL 8.0 syntax.
-- =====================================================================

ALTER TABLE post_pool
  ADD COLUMN platform_post_id     VARCHAR(255) NULL,
  ADD COLUMN reactions_count      INT NULL,
  ADD COLUMN comments_count       INT NULL,
  ADD COLUMN shares_count         INT NULL,
  ADD COLUMN views_count          INT NULL,
  ADD COLUMN engagement_synced_at DATETIME NULL;
