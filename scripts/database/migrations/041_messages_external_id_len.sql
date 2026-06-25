-- =====================================================================
-- Migration 041 — widen messages.external_id for Meta message ids
-- The column was sized for Telegram's small numeric message_id (VARCHAR(64)). But a
-- Messenger / Instagram `mid` is ~100–200 chars (and a WhatsApp `wamid` ~60), so a
-- too-long id makes strict-mode MySQL/MariaDB reject the whole INSERT. Because
-- receiveInbound creates the conversation BEFORE recording the message (no surrounding
-- transaction), that left an EMPTY conversation with no body and no AI reply — and the
-- same column is written on OUTBOUND delivery (the Send API mid), so replies were at
-- risk too. Widen to 255. Run ONCE. Additive — safe.
-- =====================================================================

ALTER TABLE messages MODIFY external_id VARCHAR(255) NULL;
