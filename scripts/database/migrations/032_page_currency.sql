-- =====================================================================
-- Migration 032 - Per-page currency
-- Each connected page has a display currency (ISO 4217 code) used to format product
-- prices in the app. Defaults to PHP (Philippine Peso). Configured in
-- Settings → Facebook Pages → Edit. Run once. Additive — safe.
-- =====================================================================

ALTER TABLE platform_accounts
  ADD COLUMN currency VARCHAR(8) NOT NULL DEFAULT 'PHP';
