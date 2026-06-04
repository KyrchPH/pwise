-- =====================================================================
-- Migration 010 — page-level insight warehouse (for the Analytics dashboard)
-- Stores daily page metrics pulled from the Graph Insights API (reach,
-- impressions, post reach, engagement, follows, unfollows). Generic
-- metric/value-by-day shape so new metrics need no schema change. Meta serves
-- the history, so we backfill once then refresh forward.
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS page_insight_daily (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  captured_on DATE NOT NULL,
  metric      VARCHAR(64) NOT NULL,
  value       BIGINT NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_page_insight_day_metric (captured_on, metric),
  INDEX idx_page_insight_metric (metric, captured_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
