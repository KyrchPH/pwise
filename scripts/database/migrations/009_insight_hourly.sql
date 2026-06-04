-- =====================================================================
-- Migration 009 — hourly insight buckets
-- Switches post_insight_history from one row per DAY (captured_on DATE) to one
-- row per HOUR (captured_at DATETIME, truncated to the hour). The Insights graph
-- then serves Hour / Day / Month from the same data (Day & Month aggregate the
-- hourly points). Existing daily rows become midnight timestamps.
-- Run ONCE against the `pwise` database (MariaDB 10.6). Run AFTER 008.
-- =====================================================================

-- Order matters: post_id has a foreign key, which always needs a backing index.
-- We rename the column and add the new (post_id, captured_at) unique key BEFORE
-- dropping idx_insight_post, so the FK is never left without an index (error 1553).
ALTER TABLE post_insight_history DROP INDEX uq_insight_post_day;
ALTER TABLE post_insight_history CHANGE COLUMN captured_on captured_at DATETIME NOT NULL;
ALTER TABLE post_insight_history ADD UNIQUE KEY uq_insight_post_hour (post_id, captured_at);
ALTER TABLE post_insight_history DROP INDEX idx_insight_post;
