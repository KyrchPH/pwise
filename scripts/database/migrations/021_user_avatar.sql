-- =====================================================================
-- Migration 021 - User profile avatar
-- Stores the S3 key for the signed-in user's profile photo. The UI requests a
-- presigned read URL through /auth/me instead of storing public object URLs.
-- =====================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_s3_key TEXT NULL AFTER module_access;
