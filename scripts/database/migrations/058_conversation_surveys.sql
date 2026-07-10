-- Customer satisfaction surveys (CSAT + NPS) for handled conversations.
-- When an agent adds a note to a conversation (the "conversation completed" signal),
-- the server rolls an admin-configured per-page chance (platform_accounts.survey_config)
-- and may email the customer a two-question survey: satisfaction with how the agent
-- handled the conversation (1-5) and likelihood to recommend the company (NPS 0-10).
-- Sends are SILENT — agents are never told a specific customer was surveyed; stats are
-- only reported in day-lagged aggregates (today's sends surface tomorrow).
-- The customer's email comes from the order / agreement linked to the conversation
-- (Messenger's API does not expose emails); email_source records where it came from.

ALTER TABLE platform_accounts
  ADD COLUMN survey_config JSON NULL;

CREATE TABLE IF NOT EXISTS conversation_surveys (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  token           CHAR(40) NOT NULL,               -- crypto-random hex; the public-link capability
  account_id      INT NOT NULL,                    -- page scope
  conversation_id INT NULL,                        -- thread that was rated (SET NULL keeps the stat)
  agent_user_id   INT NULL,                        -- agent whose handling is rated (snapshot at send)
  agent_name      VARCHAR(255) NULL,               -- durable display name
  customer_name   VARCHAR(255) NULL,
  email           VARCHAR(255) NOT NULL,
  email_source    VARCHAR(20) NOT NULL DEFAULT 'order',  -- 'order' | 'agreement' (future: 'facebook')
  satisfaction    TINYINT NULL,                    -- 1-5: how the agent handled the conversation
  nps             TINYINT NULL,                    -- 0-10: would recommend the company
  comment         TEXT NULL,                       -- optional free-text feedback
  sent_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at    DATETIME NULL,
  expires_at      DATETIME NOT NULL,               -- link validity (sent_at + 7 days)
  CONSTRAINT fk_cs_account      FOREIGN KEY (account_id)      REFERENCES platform_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_cs_conversation FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE SET NULL,
  CONSTRAINT fk_cs_agent        FOREIGN KEY (agent_user_id)   REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_cs_satisfaction CHECK (satisfaction IS NULL OR satisfaction BETWEEN 1 AND 5),
  CONSTRAINT chk_cs_nps          CHECK (nps IS NULL OR nps BETWEEN 0 AND 10),
  UNIQUE KEY uq_cs_token (token),
  INDEX idx_cs_account_sent (account_id, sent_at),
  INDEX idx_cs_conversation (conversation_id, sent_at),
  INDEX idx_cs_email (account_id, email, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
