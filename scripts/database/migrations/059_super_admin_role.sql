-- Migration 059 - add transferable super admin role.
-- Existing installs may or may not have the named CHECK constraint depending on
-- whether they were created from schema.sql or the older incremental migrations.

SET @has_chk_users_role := (
  SELECT COUNT(*)
    FROM information_schema.check_constraints
   WHERE constraint_schema = DATABASE()
     AND constraint_name = 'chk_users_role'
);

SET @drop_chk_users_role := IF(
  @has_chk_users_role > 0,
  'ALTER TABLE users DROP CHECK chk_users_role',
  'SELECT 1'
);
PREPARE drop_stmt FROM @drop_chk_users_role;
EXECUTE drop_stmt;
DEALLOCATE PREPARE drop_stmt;

ALTER TABLE users
  ADD CONSTRAINT chk_users_role CHECK (role IN ('super_admin', 'admin', 'user'));

UPDATE users
   SET role = 'super_admin'
 WHERE role = 'admin'
   AND deleted_at IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM (SELECT id FROM users WHERE role = 'super_admin' AND deleted_at IS NULL LIMIT 1) existing_super
   )
 ORDER BY created_at ASC, id ASC
 LIMIT 1;
