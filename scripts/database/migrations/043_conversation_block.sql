-- =====================================================================
-- Migration 043 — Block a customer on a conversation
-- A blocked thread stops receiving inbound (the gateway drops the customer's messages
-- and never forwards them to n8n). Both a Live Agent (human) and the AI Agent can
-- block; only a Live Agent can UNBLOCK (incl. AI-handled threads). blocked_by is the
-- agent's user id (NULL when the AI blocked); blocked_by_name is the durable display
-- snapshot ('AI Agent' for the AI). Run ONCE. Additive — safe.
-- =====================================================================

ALTER TABLE conversations
  ADD COLUMN blocked         TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN blocked_at      DATETIME NULL,
  ADD COLUMN blocked_by      INT NULL,
  ADD COLUMN blocked_by_name VARCHAR(255) NULL;
