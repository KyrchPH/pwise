import { query } from '../config/db.js';
import { moduleAccessForUser } from '../config/modules.js';
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
