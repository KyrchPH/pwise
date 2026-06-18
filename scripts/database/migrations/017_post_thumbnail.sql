-- =====================================================================
-- Migration 017 - post preview thumbnails
-- Stores the S3 key of an optimized still generated at upload time (a video's
-- first frame, or a downscaled image). The UI shows this lightweight preview in
-- grids and the viewer instead of fetching the full media just to display a
-- poster. Generated in the browser, uploaded as its own S3 object; NULL when no
-- thumbnail could be produced. Run after post_pool exists.
-- =====================================================================

ALTER TABLE post_pool
  ADD COLUMN IF NOT EXISTS thumbnail_s3_key TEXT NULL AFTER s3_key;
