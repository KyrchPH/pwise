-- =====================================================================
-- Migration 018 - optional Telegram bot per Facebook page
-- A Facebook page can OPTIONALLY have a Telegram bot attached (a bot cannot exist
-- without a page). These columns hang off the page's own platform_accounts row:
--   * telegram_bot_name     — the bot's display name
--   * telegram_bot_token    — the bot API key (ENCRYPTED, like access_token)
--   * telegram_bot_username — the bot's @username (from Telegram getMe, for display)
-- All NULL when no bot is attached. Run once. Additive — safe.
-- =====================================================================

ALTER TABLE platform_accounts
  ADD COLUMN IF NOT EXISTS telegram_bot_name     VARCHAR(255) NULL AFTER access_token,
  ADD COLUMN IF NOT EXISTS telegram_bot_token    TEXT         NULL AFTER telegram_bot_name,
  ADD COLUMN IF NOT EXISTS telegram_bot_username VARCHAR(255) NULL AFTER telegram_bot_token;
