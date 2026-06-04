-- =====================================================================
-- Migration 007 — log content-note actions in the activity feed
-- Lets post_activity_log also record content-note actions (create / edit /
-- delete / tag), attributed to the acting user. `note_id` is set instead of
-- post_id for note rows (intentionally no FK — a note delete just leaves the
-- snapshot row, same as posts). Also broadens the action vocabulary with
-- 'tagged' (status changes).
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- (Run 006_content_notes.sql first — it now includes the note `status` column.)
-- =====================================================================

ALTER TABLE post_activity_log ADD COLUMN IF NOT EXISTS note_id INT NULL AFTER post_id;

-- MariaDB drops a named CHECK with DROP CONSTRAINT (DROP CHECK is MySQL-8 only).
ALTER TABLE post_activity_log DROP CONSTRAINT chk_activity_action;
ALTER TABLE post_activity_log
  ADD CONSTRAINT chk_activity_action CHECK (action IN ('created','edited','deleted','tagged'));
