-- =====================================================================
-- Migration 006 — content_notes (per-day content planning)
-- Adds a simple notes table behind the calendar: each row is one planning note
-- attached to a calendar day (note_date). The Dashboard calendar opens a day to
-- list / add / edit / delete its notes. Shared pool (every signed-in user sees
-- and edits all notes); user_id / user_name record the author for display.
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS content_notes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  note_date  DATE NOT NULL,                 -- the calendar day this note plans for
  content    TEXT NOT NULL,
  status     VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | ongoing | completed | cancelled
  user_id    INT NULL,                      -- author (audit); shared pool like posts
  user_name  VARCHAR(255),                  -- snapshot for durable display
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_content_notes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_content_notes_status CHECK (status IN ('pending','ongoing','completed','cancelled')),
  INDEX idx_content_notes_date (note_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
