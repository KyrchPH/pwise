-- =====================================================================
-- Migration 030 - Per-page messaging analytics config
-- Holds the configurable thresholds for the live-agent response metrics shown on
-- the Messaging page (CRR / FRT / ART): the CRR "responded within" window and the
-- FRT/ART target times, plus the measurement period. JSON so it can grow; NULL =
-- use the built-in defaults (server: src/services/messaging_analytics.service.js).
--   { periodDays, crrWindowHours, frtTargetSeconds, artTargetSeconds }
-- Run once. Additive — safe.
-- =====================================================================

ALTER TABLE platform_accounts
  ADD COLUMN analytics_config JSON NULL;
