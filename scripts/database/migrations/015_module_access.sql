-- =====================================================================
-- Migration 015 - invite/user module access
-- Stores the module IDs selected when an admin generates a login link, then
-- copies them onto the user created from that link.
-- =====================================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS module_access JSON NULL AFTER role;

ALTER TABLE invites
  ADD COLUMN IF NOT EXISTS module_access JSON NULL AFTER created_by;

