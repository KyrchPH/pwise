-- =====================================================================
-- Migration 025 — Wise Assistant (Rovi) chat history, per user
-- Rovi's help chat lived only in the browser (localStorage), so it didn't follow
-- a user across devices. Store the capped conversation server-side: one row per
-- user, messages JSON = [{ "role": "user"|"agent", "text": "…" }, …] (newest last,
-- intro greeting excluded). Run ONCE (MariaDB 10.6). Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS wise_assistant_chats (
  user_id    INT NOT NULL PRIMARY KEY,
  messages   JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_wise_chat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
