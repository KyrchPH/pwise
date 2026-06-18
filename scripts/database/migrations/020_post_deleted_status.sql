-- =====================================================================
-- Migration 020 — add the 'deleted' post status
-- A published post can be removed on Facebook directly (outside the App). When the
-- App notices the post no longer exists there (e.g. its comments/insights can't be
-- loaded), it marks the record 'deleted' so the user can re-post or remove it.
-- Run ONCE against the `pwise` database (MariaDB 10.6). Additive — safe.
-- =====================================================================

-- MariaDB drops a named CHECK with DROP CONSTRAINT; DROP CHECK is MySQL-8 only.
ALTER TABLE post_pool DROP CONSTRAINT chk_post_pool_status;
ALTER TABLE post_pool
  ADD CONSTRAINT chk_post_pool_status
  CHECK (status IN ('draft','ready','posting','posted','failed','archived','expired','deleted'));
