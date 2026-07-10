-- =====================================================================
-- Migration 064 - User Roles (named access presets)
-- Admins create named roles that bundle a fixed set of module access, then
-- bind an account or invite to a role in one click instead of ticking modules
-- one by one. Roles are LIVE-LINKED: editing a role's access fans out to every
-- account and unused invite bound to it (the fan-out UPDATE lives in the app,
-- roles.service.js — `module_access` stays the effective source of truth so the
-- access-resolution core is untouched).
--
-- `role_id` on users/invites is the live link + label. ON DELETE SET NULL means
-- deleting a role leaves bound accounts' `module_access` intact (they just become
-- "Custom"), so no one silently loses access.
--
-- Named `access_roles` (not `roles`) to avoid confusion with the existing
-- `users.role` auth column (super_admin/admin/user). `created_by` is a plain audit
-- column (no FK) to keep table ordering simple and schema.sql/migration identical.
--
-- MariaDB 10.6-friendly + re-runnable: IF [NOT] EXISTS guards + DROP-then-ADD for
-- the foreign keys. Run once (via `npm run db:migrate:roles`). Additive.
-- =====================================================================

-- 1. Roles catalog ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS access_roles (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(80) NOT NULL,
  module_access JSON NOT NULL,
  created_by    INT NULL,                         -- creator (audit only, no FK)
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_access_roles_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Bind accounts to a role ------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INT NULL AFTER module_access;
ALTER TABLE users DROP FOREIGN KEY IF EXISTS fk_users_access_role;
ALTER TABLE users
  ADD CONSTRAINT fk_users_access_role FOREIGN KEY (role_id) REFERENCES access_roles(id) ON DELETE SET NULL;

-- 3. Bind invites to a role -------------------------------------------------
ALTER TABLE invites ADD COLUMN IF NOT EXISTS role_id INT NULL AFTER module_access;
ALTER TABLE invites DROP FOREIGN KEY IF EXISTS fk_invites_access_role;
ALTER TABLE invites
  ADD CONSTRAINT fk_invites_access_role FOREIGN KEY (role_id) REFERENCES access_roles(id) ON DELETE SET NULL;
