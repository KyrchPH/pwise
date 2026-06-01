-- =====================================================================
-- Auto Post Agent — development seed data (MySQL)
-- Idempotent: re-running will not create duplicates.
-- Apply with `npm run db:seed` (run `npm run db:migrate` first).
--
-- Demo login:  demo@example.com  /  Password123!
-- (password_hash below is a bcrypt hash of that password)
-- =====================================================================

-- Demo user (INSERT IGNORE -> no-op if the email already exists) ---------
INSERT IGNORE INTO users (name, email, password_hash)
VALUES (
  'Demo User',
  'demo@example.com',
  '$2a$10$x17y.GCSS07n/xwK6AhLzug5CkHpbAGw1ZU85OBAVyf8QJwbXQWzG'
);

-- Posting settings for the demo user (UNIQUE user_id -> no-op on re-run) --
INSERT IGNORE INTO posting_settings (user_id, is_enabled, owner_email)
SELECT id, TRUE, email
FROM users
WHERE email = 'demo@example.com';

-- A few sample posts (only if the demo user has none yet) ----------------
-- The inner (SELECT ... FROM post_pool) derived table is required: MySQL
-- forbids referencing the INSERT target table directly in a subquery.
INSERT INTO post_pool (user_id, caption, media_type, media_url, s3_key, target_platform, status, priority)
SELECT u.id, x.caption, x.media_type, x.media_url, x.s3_key, x.target_platform, x.status, x.priority
FROM users u
JOIN (
  SELECT 'First ready post 🚀'          AS caption, 'image' AS media_type,
         'https://demo-bucket.s3.amazonaws.com/demo/post1.jpg' AS media_url,
         'demo/post1.jpg' AS s3_key, 'facebook' AS target_platform,
         'ready' AS status, 10 AS priority
  UNION ALL
  SELECT 'Second ready post ✨', 'image',
         'https://demo-bucket.s3.amazonaws.com/demo/post2.jpg',
         'demo/post2.jpg', 'facebook', 'ready', 5
  UNION ALL
  SELECT 'A draft still being written', 'video',
         'https://demo-bucket.s3.amazonaws.com/demo/post3.mp4',
         'demo/post3.mp4', 'facebook', 'draft', 0
) x
WHERE u.email = 'demo@example.com'
  AND NOT EXISTS (
    SELECT 1 FROM (SELECT user_id FROM post_pool) AS p WHERE p.user_id = u.id
  );
