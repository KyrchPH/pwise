-- =====================================================================
-- Migration 024 — connections (agent-to-agent "friend" graph)
-- A connection gates replying in A2A DMs: a cold message auto-creates a pending
-- request; the receiver must accept (become a connection) before they can reply.
-- One row per pair (requester→addressee). Run ONCE (MariaDB 10.6). Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS user_connections (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  requester_id INT NOT NULL,
  addressee_id INT NOT NULL,
  status       VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | accepted
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at DATETIME NULL,
  UNIQUE KEY uq_connection_pair (requester_id, addressee_id),
  INDEX idx_connection_addressee (addressee_id, status),
  INDEX idx_connection_requester (requester_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
