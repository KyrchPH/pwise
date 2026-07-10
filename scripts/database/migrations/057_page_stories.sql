-- page_stories — 24-hour Stories published to Facebook / Instagram (Contents → Stories).
-- One row per story per destination: publishing the same media to both platforms
-- creates two rows, each with its own status / platform id / expiry. Stories are
-- published DIRECTLY via the Graph API (not through the n8n post workflow): they
-- carry no caption, can't be scheduled on Meta's side, and expire after 24 hours
-- (expires_at = posted_at + 24h; the UI derives "expired" from it — status stays
-- 'posted'). Shared pool like post_pool: user_id records the creator (audit).
CREATE TABLE IF NOT EXISTS page_stories (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  user_id           INT NULL,                    -- creator (audit; survives user deletion)
  account_id        INT NOT NULL,                -- the connected page it publishes through
  platform          VARCHAR(20) NOT NULL,        -- 'facebook' | 'instagram'
  media_type        VARCHAR(20) NOT NULL,        -- 'image' | 'video'
  s3_key            TEXT,                        -- private S3 object, presigned on read
  thumbnail_s3_key  TEXT,                        -- optimized still for grid previews
  status            VARCHAR(20) NOT NULL DEFAULT 'posting',
  platform_story_id VARCHAR(255) NULL,           -- FB story post id / IG media id
  failed_reason     TEXT,
  posted_at         DATETIME NULL,
  expires_at        DATETIME NULL,               -- posted_at + 24h
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_page_stories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_page_stories_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
  CONSTRAINT chk_page_stories_platform CHECK (platform IN ('facebook','instagram')),
  CONSTRAINT chk_page_stories_media_type CHECK (media_type IN ('image','video')),
  CONSTRAINT chk_page_stories_status CHECK (status IN ('posting','posted','failed')),
  INDEX idx_page_stories_account (account_id, created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
