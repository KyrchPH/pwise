-- Team-shared "handled" state for the Comments inbox (Contents → Comments).
-- The inbox aggregates live Facebook comments across a page's posts; comment CONTENT
-- is never stored (read live from Graph). This table stores ONLY the tracking state so
-- every teammate on a page sees the same handled/unhandled list. A row present with
-- status='done' = handled; un-marking a comment deletes its row (absence = open).
CREATE TABLE IF NOT EXISTS post_comment_status (
  account_id      INT NOT NULL,
  comment_id      VARCHAR(255) NOT NULL,
  post_id         INT NULL,
  status          ENUM('open','done') NOT NULL DEFAULT 'done',
  handled_by_id   INT NULL,
  handled_by_name VARCHAR(255) NULL,
  handled_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (account_id, comment_id),
  KEY idx_pcs_status (account_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
