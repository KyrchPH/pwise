-- =====================================================================
-- Migration 039 - Track each user's last-active time (for presence text).
-- The presence heartbeat (POST /api/presence/ping) stamps this; the Agent-to-Agent
-- view shows "Active now" when online and "Active X ago" when offline.
-- Run once. Additive — safe.
-- =====================================================================

ALTER TABLE users ADD COLUMN last_seen_at DATETIME NULL;
