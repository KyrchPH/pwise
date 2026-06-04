-- =====================================================================
-- Migration 005 — add the 'expired' post status
-- Overdue scheduled posts (more than the expiry cutoff past their scheduled
-- time) are marked 'expired' by the scheduler and never published — so a missed
-- post can't fire late or jump ahead of on-time posts. Rescheduling it (editing
-- the date/time to a future slot) revives it to 'ready'.
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- =====================================================================

-- MariaDB drops a named CHECK with DROP CONSTRAINT; DROP CHECK is MySQL-8 only (error 1064 here).
ALTER TABLE post_pool DROP CONSTRAINT chk_post_pool_status;
ALTER TABLE post_pool
  ADD CONSTRAINT chk_post_pool_status
  CHECK (status IN ('draft','ready','posting','posted','failed','archived','expired'));
