-- =====================================================================
-- Migration 049 - Planner goals
-- The Planner module: a user sets a measurable goal for one page — a metric
-- (followers | posts | comments | shares | views | reactions), a target number,
-- a cadence label (daily | weekly | monthly | quarterly | yearly) and a date
-- range. Progress is measured as GROWTH WITHIN the range: posts/engagement
-- accrued between start_date and end_date; followers = net gained since the goal
-- was created (baseline_value captured at creation). status/completed_at are
-- persisted terminal states, reconciled on read by the service, so a completed
-- goal stays completed even if engagement later drops.
-- Goals are workspace-wide (everyone sees them); account_id ties each to a page,
-- created_by records who made it (audit). Run once. Additive — safe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS planner_goals (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  account_id     INT NOT NULL,                 -- page the goal tracks
  created_by     INT NULL,                     -- user who created it (audit)
  title          VARCHAR(255) NOT NULL,
  metric         VARCHAR(20)  NOT NULL,        -- followers|posts|comments|shares|views|reactions
  period         VARCHAR(20)  NOT NULL,        -- daily|weekly|monthly|quarterly|yearly
  target_value   BIGINT       NOT NULL,
  baseline_value BIGINT       NULL,            -- follower count captured at creation (followers metric only)
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  status         VARCHAR(20)  NOT NULL DEFAULT 'ongoing',  -- ongoing|completed|expired
  completed_at   DATETIME     NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_planner_goals_account FOREIGN KEY (account_id) REFERENCES platform_accounts(id) ON DELETE CASCADE,
  CONSTRAINT fk_planner_goals_user    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT chk_planner_goals_metric CHECK (metric IN ('followers','posts','comments','shares','views','reactions')),
  CONSTRAINT chk_planner_goals_period CHECK (period IN ('daily','weekly','monthly','quarterly','yearly')),
  CONSTRAINT chk_planner_goals_status CHECK (status IN ('ongoing','completed','expired')),
  INDEX idx_planner_goals_account (account_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
