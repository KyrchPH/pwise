-- =====================================================================
-- Migration 023 — agent-to-agent chat (internal team messaging)
-- DMs and group chats between agents, kept separate from customer threads.
-- Run ONCE (MariaDB 10.6). Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS agent_conversations (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  is_group        TINYINT(1) NOT NULL DEFAULT 0,
  name            VARCHAR(255) NULL,                 -- group name (NULL for DMs)
  created_by      INT NULL,
  last_message_at DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_agent_conv_activity (last_message_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_conversation_participants (
  conversation_id INT NOT NULL,
  user_id         INT NOT NULL,
  last_read_at    DATETIME NULL,
  joined_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, user_id),
  INDEX idx_agent_part_user (user_id),
  CONSTRAINT fk_agent_part_conv FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS agent_messages (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_user_id  INT NULL,
  sender_name     VARCHAR(255),                      -- denormalized so it survives user deletion
  body            TEXT NULL,
  media           JSON NULL,                         -- [{ type, url, name }]
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_agent_msg_conv FOREIGN KEY (conversation_id) REFERENCES agent_conversations(id) ON DELETE CASCADE,
  INDEX idx_agent_msg_conv (conversation_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
