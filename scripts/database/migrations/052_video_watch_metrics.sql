-- =====================================================================
-- Migration 052 — video watch metrics
-- Adds total watch time + average time watched (per view) for video posts,
-- pulled from the Graph API's /{video-id}/video_insights endpoint
-- (total_video_view_time, total_video_avg_time_watched — stored in SECONDS).
-- NULL for image/text posts and for videos not yet synced.
-- Run ONCE against the `pwise` database (paste into MySQL Workbench, or pipe
-- through the mysql client). Standard MySQL 8.0 syntax.
-- =====================================================================

ALTER TABLE post_pool
  ADD COLUMN video_watch_time_s INT NULL AFTER views_count,
  ADD COLUMN video_avg_watch_s  INT NULL AFTER video_watch_time_s;
