-- =====================================================================
-- Migration 013 — per-page Analytics
-- Tags daily page-level metrics with the connected page they belong to, so the
-- Analytics dashboard can be scoped to the active page.
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- (Backfill existing rows to your imported page via `npm run fb:import-env`.)
-- =====================================================================

ALTER TABLE page_insight_daily
  ADD COLUMN IF NOT EXISTS account_id INT NULL AFTER id,
  DROP INDEX IF EXISTS uq_page_insight_day_metric,
  ADD UNIQUE KEY IF NOT EXISTS uq_page_insight_acct_day_metric (account_id, captured_on, metric),
  ADD INDEX IF NOT EXISTS idx_page_insight_acct_metric (account_id, metric, captured_on);
