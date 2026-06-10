-- 014: email-verified password changes.
-- One pending code per user (user_id is the PK, so a new request UPSERTs over
-- the old one). The code is stored hashed; the row is consumed on success or
-- replaced/expired otherwise.
CREATE TABLE IF NOT EXISTS password_change_codes (
  user_id    INT NOT NULL PRIMARY KEY,
  code_hash  VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  verified   BOOLEAN NOT NULL DEFAULT FALSE,
  attempts   INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_pcc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
