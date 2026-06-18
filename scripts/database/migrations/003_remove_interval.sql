-- =====================================================================
-- Migration 003 — exact-scheduling only (remove interval posting)
-- Drops the interval / allowed-window columns from posting_settings. Posts now
-- always carry an explicit scheduled_at and the scheduler has no interval
-- fallback.
-- Run ONCE against the `pwise` database (MySQL 8.0). Apply AFTER deploying the
-- matching server code, which no longer reads or writes these columns.
-- =====================================================================

ALTER TABLE posting_settings
  DROP COLUMN posting_interval_minutes,
  DROP COLUMN allowed_start_time,
  DROP COLUMN allowed_end_time;
