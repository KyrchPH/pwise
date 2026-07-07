-- =====================================================================
-- Migration 049 — content_notes: per-day ordering + per-note colors
-- Adds three columns to content_notes:
--   * position   — the note's rank within its day (drives drag-to-reorder in the
--                  day dialog; lower = higher in the list).
--   * text_color — optional hex (#RRGGBB[AA]) override for the note's text.
--   * note_color — optional hex (#RRGGBB[AA]) override for the note's background.
-- Existing rows are backfilled with a stable position per day (by created_at),
-- so today's order is preserved. Colors default to NULL (theme defaults).
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- (Run 006_content_notes.sql first.)
-- =====================================================================

ALTER TABLE content_notes ADD COLUMN IF NOT EXISTS position   INT NOT NULL DEFAULT 0 AFTER status;
ALTER TABLE content_notes ADD COLUMN IF NOT EXISTS text_color VARCHAR(9) NULL AFTER position;
ALTER TABLE content_notes ADD COLUMN IF NOT EXISTS note_color VARCHAR(9) NULL AFTER text_color;

-- Backfill position: rank each day's notes by their existing add order (0-based),
-- so the current top-to-bottom order is preserved after the switch to explicit
-- ordering. MariaDB 10.6 supports window functions + UPDATE ... JOIN.
UPDATE content_notes c
  JOIN (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY note_date ORDER BY created_at ASC, id ASC) - 1 AS rn
      FROM content_notes
  ) ranked ON ranked.id = c.id
  SET c.position = ranked.rn;

-- Ordering within a day is by (note_date, position); a composite index keeps the
-- day dialog's list query fast as the pool grows.
ALTER TABLE content_notes ADD INDEX IF NOT EXISTS idx_content_notes_date_pos (note_date, position);
