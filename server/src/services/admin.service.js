import { query } from '../config/db.js';
import { APP_MODULES, moduleAccessForUser, normalizeModuleAccess, serializeModuleAccess } from '../config/modules.js';
import ApiError from '../utils/ApiError.js';

// All accounts for the admin Accounts tab (password hash never exposed).
export async function listUsers() {
  const rows = await query(
    `SELECT id, name, email, role, is_active, deleted_at, created_at, module_access
     FROM users
     ORDER BY created_at DESC`,
  );
  return rows.map((row) => ({ ...row, module_access: moduleAccessForUser(row) }));
}

export async function setActive(id, active) {
  const res = await query('UPDATE users SET is_active = ? WHERE id = ? AND deleted_at IS NULL', [active ? 1 : 0, id]);
  if (!res.affectedRows) throw ApiError.notFound('user not found (or already deleted)');
  return { id: Number(id), is_active: !!active };
}

// Soft delete: keep the row, mark deleted + deactivate so it can't log in.
export async function softDelete(id) {
  const res = await query('UPDATE users SET deleted_at = UTC_TIMESTAMP(), is_active = 0 WHERE id = ?', [id]);
  if (!res.affectedRows) throw ApiError.notFound('user not found');
  return { id: Number(id), deleted: true };
}

// Replace a user's module access. Admin-only modules (e.g. Accounts) are never
// grantable here. Admins already have full access by role, so editing their list
// has no effect — the UI only offers this for non-admin users.
export async function setModuleAccess(id, modules) {
  const rows = await query('SELECT id, deleted_at FROM users WHERE id = ?', [id]);
  const target = rows[0];
  if (!target || target.deleted_at) throw ApiError.notFound('user not found');
  const requested = normalizeModuleAccess(modules);
  if (!requested || requested.length === 0) throw ApiError.badRequest('select at least one module');
  const adminOnly = requested.filter((mid) => APP_MODULES.find((m) => m.id === mid)?.adminOnly);
  if (adminOnly.length) throw ApiError.badRequest("admin-only modules can't be granted");
  await query('UPDATE users SET module_access = ? WHERE id = ? AND deleted_at IS NULL', [
    serializeModuleAccess(requested),
    id,
  ]);
  return { id: Number(id), module_access: requested };
}
