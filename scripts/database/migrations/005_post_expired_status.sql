-- =====================================================================
-- Migration 005 — add the 'expired' post status
-- Overdue scheduled posts (more than the expiry cutoff past their scheduled
-- time) are marked 'expired' by the scheduler and never published — so a missed
-- post can't fire late or jump ahead of on-time posts. Rescheduling it (editing
-- the date/time to a future slot) revives it to 'ready'.
-- Run ONCE against the `pwise` database (MySQL 8.0). Additive — safe.
-- =====================================================================

ALTER TABLE post_pool DROP CHECK chk_post_pool_status;
ALTER TABLE post_pool
  ADD CONSTRAINT chk_post_pool_status
  CHECK (status IN ('draft','ready','posting','posted','failed','archived','expired'));
