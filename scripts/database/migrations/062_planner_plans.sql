-- =====================================================================
-- Migration 062 - Planner plans + sharing (roles) + new measures
-- Adds a PLAN layer above goals. A plan groups goals and carries its own
-- membership: people from the creator's connections, each with an access role
--   viewer → can only see the plan's goals
--   editor → can also edit a goal's details
--   owner  → can also add / delete goals and manage the plan + its members
-- Visibility becomes plan-scoped: a user sees a plan only if they're a member
-- (admins bypass, like elsewhere). The creator is auto-added as an owner.
--
-- Also extends planner_goals.metric with four live-tracked measures:
--   sales      → SUM(orders.total) for the page in the goal's date range
--   promoters  → COUNT(conversation_surveys.nps >= 9)      in range
--   neutral    → COUNT(conversation_surveys.nps BETWEEN 7 AND 8) in range
--   detractors → COUNT(conversation_surveys.nps <= 6)      in range
--
-- Idempotent backfill (only if pre-Plan goals exist): a "General" plan owned by
-- the first admin adopts every orphan goal, and every active user is added as an
-- owner so the prior workspace-wide "everyone manages" behaviour is preserved
-- for legacy goals. Run once (via `npm run db:migrate:planner-plans`). Additive.
-- =====================================================================

-- 1. Plan container ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS planner_plans (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description VARCHAR(500) NULL,
  created_by  INT NULL,                         -- creator (audit); membership row holds the role
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_planner_plans_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Plan membership / access allow-list ------------------------------------
CREATE TABLE IF NOT EXISTS planner_plan_members (
  plan_id  INT NOT NULL,
  user_id  INT NOT NULL,
  role     VARCHAR(10) NOT NULL DEFAULT 'viewer',   -- viewer | editor | owner
  added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_id, user_id),
  CONSTRAINT fk_ppm_plan FOREIGN KEY (plan_id) REFERENCES planner_plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_ppm_user FOREIGN KEY (user_id) REFERENCES users(id)         ON DELETE CASCADE,
  CONSTRAINT chk_ppm_role CHECK (role IN ('viewer','editor','owner')),
  INDEX idx_ppm_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Attach goals to a plan + widen the metric whitelist --------------------
-- MariaDB-friendly + re-runnable: IF [NOT] EXISTS guards let a partial/repeat
-- run finish cleanly. Drop-then-add is how a CHECK constraint is modified.
ALTER TABLE planner_goals ADD COLUMN IF NOT EXISTS plan_id INT NULL AFTER account_id;
ALTER TABLE planner_goals ADD INDEX IF NOT EXISTS idx_planner_goals_plan (plan_id, status);
ALTER TABLE planner_goals DROP FOREIGN KEY IF EXISTS fk_planner_goals_plan;
ALTER TABLE planner_goals
  ADD CONSTRAINT fk_planner_goals_plan FOREIGN KEY (plan_id) REFERENCES planner_plans(id) ON DELETE CASCADE;

ALTER TABLE planner_goals DROP CONSTRAINT IF EXISTS chk_planner_goals_metric;
ALTER TABLE planner_goals
  ADD CONSTRAINT chk_planner_goals_metric CHECK (
    metric IN ('followers','posts','comments','shares','views','reactions',
               'sales','promoters','neutral','detractors')
  );

-- 4. Backfill legacy goals (no-op on a fresh DB — nothing has plan_id IS NULL)
-- 4a. One "General" plan, owned by the first admin, only if orphan goals exist.
INSERT INTO planner_plans (name, description, created_by)
SELECT 'General', 'Goals created before Plans existed',
       (SELECT id FROM users WHERE role IN ('admin','super_admin') ORDER BY id LIMIT 1)
  FROM DUAL
 WHERE EXISTS (SELECT 1 FROM planner_goals WHERE plan_id IS NULL);

-- 4b. Adopt every orphan goal into that General plan.
UPDATE planner_goals
   SET plan_id = (SELECT id FROM planner_plans WHERE name = 'General' ORDER BY id DESC LIMIT 1)
 WHERE plan_id IS NULL;

-- 4c. Preserve the old "everyone manages" behaviour: every active user is an
--     owner of the General plan. INSERT IGNORE keeps re-runs safe.
INSERT IGNORE INTO planner_plan_members (plan_id, user_id, role)
SELECT p.id, u.id, 'owner'
  FROM planner_plans p
  JOIN users u ON u.is_active = 1 AND u.deleted_at IS NULL
 WHERE p.name = 'General'
   AND p.id = (SELECT MAX(id) FROM planner_plans WHERE name = 'General');
