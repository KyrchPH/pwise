-- =====================================================================
-- One-off: clear ALL customer conversations (the messaging inbox).
-- Wipes conversations + their messages, pending transfers, and per-conversation
-- notes, then resets the auto-increment IDs to 1. Does NOT touch platform_accounts
-- (your pages / bot tokens), agent-to-agent chats, connections, the vault, or posts.
-- The AI agents' short-term memory is separate — it lives in Redis (n8n), so flush
-- that too (redis-cli FLUSHALL) if you want the assistant to forget these threads.
--
-- DESTRUCTIVE — deletes real AND dummy threads. Be sure DATABASE_URL (root .env)
-- points at the database you intend before running:
--   node src/db/apply.js database/clear-conversations.sql      (from scripts/)
-- =====================================================================

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE messages;
TRUNCATE TABLE conversations;
TRUNCATE TABLE conversation_transfers;
TRUNCATE TABLE conversation_notes;
SET FOREIGN_KEY_CHECKS = 1;
