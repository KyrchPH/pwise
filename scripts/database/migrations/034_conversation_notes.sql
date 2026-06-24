-- =====================================================================
-- Migration 034 - Per-conversation notes
-- Short, immutable "sticky" notes attached to a customer conversation: free text
-- (links allowed, no images) recording what happened in past chats, stamped with
-- the author and time. Any Messaging user can add one; notes can NOT be edited, and
-- only admins can delete them. The AI also drops one automatically on every handoff
-- to a live agent. Surfaced on the conversation view as a floating card (most-recent
-- first, with prev/next) plus a side drawer (client). Deleting a conversation removes
-- its notes (FK CASCADE). No updated_at — rows never change.
-- Run once. Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS conversation_notes (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  body            TEXT NOT NULL,
  created_by      INT NULL,
  created_by_name VARCHAR(255),
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_conversation_notes_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_conversation_notes_conv (conversation_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
