import { getConnection, query } from '../config/db.js';
import {
  APP_MODULES,
  MODULE_IDS,
  isAdminRole,
  isSuperAdminRole,
  moduleAccessForUser,
  normalizeModuleAccess,
  serializeModuleAccess,
} from '../config/modules.js';
import * as rolesService from './roles.service.js';
import ApiError from '../utils/ApiError.js';

async function activeUserById(id) {
  const rows = await query('SELECT id, name, email, role, deleted_at FROM users WHERE id = ?', [id]);
  const user = rows[0];
  if (!user || user.deleted_at) throw ApiError.notFound('user not found');
  return user;
}

async function assertNotSuperAdminTarget(id) {
  const target = await activeUserById(id);
  if (isSuperAdminRole(target.role)) {
    throw ApiError.badRequest('transfer the super admin role before changing this account');
  }
  return target;
}

// All accounts for the admin Accounts tab (password hash never exposed). locked_until +
// failed_login_attempts drive the "Locked" badge and the Unlock action.
export async function listUsers() {
  const rows = await query(
    `SELECT u.id, u.name, u.email, u.role, u.is_active, u.deleted_at, u.created_at, u.module_access,
            u.role_id, ar.name AS role_name,
            u.locked_until, u.failed_login_attempts
     FROM users u
     LEFT JOIN access_roles ar ON ar.id = u.role_id
     ORDER BY u.created_at DESC`,
  );
  return rows.map((row) => ({ ...row, module_access: isAdminRole(row.role) ? MODULE_IDS : moduleAccessForUser(row) }));
}

// Clear a brute-force lockout (and its counter) so the account can log in again.
export async function unlockAccount(id) {
  const res = await query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ? AND deleted_at IS NULL',
    [id],
  );
  if (!res.affectedRows) throw ApiError.notFound('user not found (or already deleted)');
  return { id: Number(id), unlocked: true };
}

export async function setActive(id, active) {
  await assertNotSuperAdminTarget(id);
  const res = await query('UPDATE users SET is_active = ? WHERE id = ? AND deleted_at IS NULL', [active ? 1 : 0, id]);
  if (!res.affectedRows) throw ApiError.notFound('user not found (or already deleted)');
  return { id: Number(id), is_active: !!active };
}

// Soft delete: keep the row, mark deleted + deactivate so it can't log in.
export async function softDelete(id) {
  await assertNotSuperAdminTarget(id);
  const res = await query('UPDATE users SET deleted_at = UTC_TIMESTAMP(), is_active = 0 WHERE id = ?', [id]);
  if (!res.affectedRows) throw ApiError.notFound('user not found');
  return { id: Number(id), deleted: true };
}

export async function setRole(actor, id, role) {
  const nextRole = String(role || '').trim().toLowerCase();
  if (!['user', 'admin'].includes(nextRole)) throw ApiError.badRequest('role must be user or admin');
  const target = await assertNotSuperAdminTarget(id);
  if (Number(target.id) === Number(actor?.id)) throw ApiError.badRequest("you can't change your own admin role");
  if (target.role === nextRole) return { id: Number(target.id), role: nextRole };

  await query('UPDATE users SET role = ? WHERE id = ? AND deleted_at IS NULL', [nextRole, target.id]);
  return { id: Number(target.id), role: nextRole };
}

export async function transferSuperAdmin(actor, id) {
  if (!isSuperAdminRole(actor?.role)) throw ApiError.forbidden('only the current super admin can transfer this role');
  const target = await activeUserById(id);
  if (Number(target.id) === Number(actor.id)) throw ApiError.badRequest("you can't transfer the super admin role to yourself");

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [targetRows] = await conn.query(
      'SELECT id, role, is_active, deleted_at FROM users WHERE id = ? FOR UPDATE',
      [target.id],
    );
    const lockedTarget = targetRows[0];
    if (!lockedTarget || lockedTarget.deleted_at) throw ApiError.notFound('user not found');
    if (!lockedTarget.is_active) throw ApiError.badRequest('activate this user before transferring the super admin role');

    await conn.query("UPDATE users SET role = 'admin' WHERE role = 'super_admin' AND id <> ?", [lockedTarget.id]);
    await conn.query("UPDATE users SET role = 'super_admin' WHERE id = ?", [lockedTarget.id]);
    await conn.commit();
    return {
      from: { id: Number(actor.id), role: 'admin' },
      to: { id: Number(lockedTarget.id), role: 'super_admin' },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Replace a user's module access. When `roleId` is given the user is bound to that
// role (role_id set, access copied from the role); otherwise it's a custom set and
// role_id is cleared. Admin-only modules (e.g. Accounts) are never grantable here.
// Admins already have full access by role, so editing their list has no effect —
// the UI only offers this for non-admin users.
export async function setModuleAccess(id, { modules, roleId } = {}) {
  const rows = await query('SELECT id, deleted_at FROM users WHERE id = ?', [id]);
  const target = rows[0];
  if (!target || target.deleted_at) throw ApiError.notFound('user not found');

  let boundRoleId = null;
  let requested;
  if (roleId != null && roleId !== '') {
    boundRoleId = Number(roleId);
    requested = await rolesService.moduleAccessForRole(boundRoleId); // throws 404 if the role is gone
  } else {
    requested = normalizeModuleAccess(modules);
  }
  if (!requested || requested.length === 0) throw ApiError.badRequest('select at least one module');
  const adminOnly = requested.filter((mid) => APP_MODULES.find((m) => m.id === mid)?.adminOnly);
  if (adminOnly.length) throw ApiError.badRequest("admin-only modules can't be granted");

  await query('UPDATE users SET module_access = ?, role_id = ? WHERE id = ? AND deleted_at IS NULL', [
    serializeModuleAccess(requested),
    boundRoleId,
    id,
  ]);
  return { id: Number(id), module_access: requested, role_id: boundRoleId };
}
