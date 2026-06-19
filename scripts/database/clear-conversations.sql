-- =====================================================================
-- One-off: clear ALL customer conversations (the messaging inbox).
-- Wipes conversations + their messages (cascade) + pending transfers, and
-- resets the auto-increment IDs to 1. Does NOT touch platform_accounts (your
-- pages / bot tokens), agent-to-agent chats, connections, the vault, or posts.
--
-- DESTRUCTIVE — deletes real AND dummy threads. Be sure DATABASE_URL (root .env)
-- points at the database you intend before running:
--   node src/db/apply.js database/clear-conversations.sql      (from scripts/)
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE messages;
TRUNCATE TABLE conversations;
TRUNCATE TABLE conversation_transfers;
SET FOREIGN_KEY_CHECKS = 1;
