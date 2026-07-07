-- Links a Facebook comment to the Messenger conversation opened via "message a commenter",
-- so the post view can show "Messaged" (and deep-link to the thread) even after a reload.
-- One comment maps to one conversation (PK on comment_id); re-messaging relinks it.
CREATE TABLE comment_conversations (
  comment_id      VARCHAR(255) NOT NULL,
  conversation_id INT NOT NULL,
  account_id      INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);
