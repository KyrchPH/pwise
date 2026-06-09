-- =====================================================================
-- Migration 012 — multi-page Facebook support
-- Adds dynamic, encrypted page connections + a per-user "active page", and tags
-- each post with the page it publishes to.
--   * platform_accounts gains the Facebook-specific credential columns
--     (app_secret / app_client_token / access_token are stored ENCRYPTED).
--   * post_pool.account_id  — which connected page a post publishes to.
--   * posting_settings.selected_account_id — each user's currently-active page.
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- (FKs are enforced in the app's page-delete path, so they're omitted here to
--  keep the migration idempotent; fresh installs via schema.sql do declare them.)
-- =====================================================================

ALTER TABLE platform_accounts
  ADD COLUMN IF NOT EXISTS fb_page_id       VARCHAR(255) AFTER account_name,
  ADD COLUMN IF NOT EXISTS app_id           VARCHAR(255) AFTER fb_page_id,
  ADD COLUMN IF NOT EXISTS app_secret       TEXT         AFTER app_id,
  ADD COLUMN IF NOT EXISTS app_client_token TEXT         AFTER app_secret;

ALTER TABLE post_pool
  ADD COLUMN IF NOT EXISTS account_id INT NULL AFTER target_platform,
  ADD INDEX IF NOT EXISTS idx_post_pool_account (account_id, status);

ALTER TABLE posting_settings
  ADD COLUMN IF NOT EXISTS selected_account_id INT NULL AFTER last_alert_sent_at;
