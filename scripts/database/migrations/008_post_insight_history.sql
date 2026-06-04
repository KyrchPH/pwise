-- =====================================================================
-- Migration 008 — per-day engagement history (for the post Insights graph)
-- Facebook only returns a post's CURRENT engagement totals, not a daily series.
-- To plot insights over time we record one snapshot per post per day here (the
-- value pulled from Facebook during the normal engagement refresh). The graph
-- reads this table. History only builds going forward — past days can't be
-- backfilled. One row per (post_id, captured_on); upserted on each refresh.
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS post_insight_history (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  post_id         INT NOT NULL,
  captured_on     DATE NOT NULL,
  reactions_count INT NULL,
  comments_count  INT NULL,
  shares_count    INT NULL,
  views_count     INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_insight_post_day (post_id, captured_on),
  CONSTRAINT fk_insight_post FOREIGN KEY (post_id) REFERENCES post_pool(id) ON DELETE CASCADE,
  INDEX idx_insight_post (post_id, captured_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
