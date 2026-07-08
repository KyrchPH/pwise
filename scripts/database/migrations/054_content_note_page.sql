-- =====================================================================
-- Migration 054 — content_notes: owning page (page identity)
-- The Content Calendar is now a GENERAL (page-independent) feature: every user
-- sees every note across all pages, so each note records which connected page it
-- belongs to (drives the page logo shown on the calendar note rows).
--   * page_id — FK to platform_accounts(id). NULL = not tied to a page (legacy
--                rows, or a note added with no page connected). ON DELETE SET NULL
--                so removing a page keeps its notes (they just lose the badge).
-- Existing rows keep page_id = NULL (rendered with a neutral fallback avatar).
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- (Run 006_content_notes.sql first.)
-- =====================================================================

ALTER TABLE content_notes ADD COLUMN IF NOT EXISTS page_id INT NULL AFTER note_color;

-- Named so a re-run (ADD CONSTRAINT is not IF-NOT-EXISTS-guarded on MariaDB) can be
-- spotted; wrap in a tolerant add. Skip if it already exists.
ALTER TABLE content_notes
  ADD CONSTRAINT fk_content_notes_page FOREIGN KEY (page_id) REFERENCES platform_accounts(id) ON DELETE SET NULL;

ALTER TABLE content_notes ADD INDEX IF NOT EXISTS idx_content_notes_page (page_id);
