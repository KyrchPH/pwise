-- =====================================================================
-- Migration 063 — post_kind (reel / video / post)
-- Distinguishes how a pooled post is published on Facebook:
--   'post'  → text or photo (/feed or /photos)   [default; existing rows]
--   'video' → plain feed video (/videos)
--   'reel'  → Reel (/video_reels resumable upload)
-- Kept ORTHOGONAL to media_type: a reel is post_kind='reel' + media_type='video'.
-- Default 'post' backfills every existing row, preserving current behaviour
-- (existing videos stay post_kind='post' → the normal /videos path).
-- Run ONCE against the `pwise` database (paste into MySQL Workbench, or pipe
-- through the mysql client). Standard MySQL 8.0 syntax. Additive & safe.
-- =====================================================================

ALTER TABLE post_pool
  ADD COLUMN post_kind VARCHAR(20) NOT NULL DEFAULT 'post' AFTER media_type;

ALTER TABLE post_pool
  ADD CONSTRAINT chk_post_pool_kind CHECK (post_kind IN ('post','video','reel'));
