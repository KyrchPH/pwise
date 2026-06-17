-- =====================================================================
-- Migration 016 - messaging inbox
-- Customer chat threads (conversations) and their bubbles (messages) for the
-- Messaging feature. Shared/global like the rest of the app — all users see all
-- threads. Run after platform_accounts exists.
-- =====================================================================

CREATE TABLE IF NOT EXISTS conversations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  account_id      INT NULL,
  page_name       VARCHAR(255),
  customer_name   VARCHAR(255) NOT NULL,
  customer_handle VARCHAR(255),
  customer_avatar TEXT,
  origin          VARCHAR(50),
  handled_by      VARCHAR(20) NOT NULL DEFAULT 'AI Agent',
  status          VARCHAR(80),
  tags            JSON NULL,
  summary         TEXT,
  unread          INT NOT NULL DEFAULT 0,
  last_message_at DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_conversations_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
  CONSTRAINT chk_conversations_handled CHECK (handled_by IN ('AI Agent', 'Live Agent')),
  INDEX idx_conversations_account (account_id, last_message_at),
  INDEX idx_conversations_activity (last_message_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS messages (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  side            VARCHAR(10) NOT NULL,
  sender          VARCHAR(255),
  body            TEXT NULL,
  media           JSON NULL,
  reply_to        JSON NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  CONSTRAINT chk_messages_side CHECK (side IN ('incoming', 'outgoing')),
  INDEX idx_messages_conversation (conversation_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
