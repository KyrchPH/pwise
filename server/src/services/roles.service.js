import { getConnection, query } from '../config/db.js';
import {
  APP_MODULES,
  normalizeModuleAccess,
  serializeModuleAccess,
} from '../config/modules.js';
import ApiError from '../utils/ApiError.js';

// "User Roles" — named module-access presets. An account/invite can bind to a role
// (users.role_id / invites.role_id); the role's module_access is then copied onto the
// bound row so the access-resolution core keeps reading `module_access` unchanged.
// Editing a role fans that change out to every bound account + unused invite.

const MAX_NAME_LEN = 80;

function cleanName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw ApiError.badRequest('a role name is required');
  if (trimmed.length > MAX_NAME_LEN) throw ApiError.badRequest(`role name must be ${MAX_NAME_LEN} characters or fewer`);
  return trimmed;
}

// Validate a requested module set: at least one module, no admin-only modules
// (e.g. Accounts), Dashboard always included (it is the core safe landing page).
function cleanModules(modules) {
  const requested = normalizeModuleAccess(modules);
  if (!requested || requested.length === 0) throw ApiError.badRequest('select at least one module');
  const adminOnly = requested.filter((id) => APP_MODULES.find((m) => m.id === id)?.adminOnly);
  if (adminOnly.length) throw ApiError.badRequest("admin-only modules can't be granted to a role");
  if (!requested.includes('dashboard')) requested.unshift('dashboard');
  return requested;
}

function serializeRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    module_access: normalizeModuleAccess(row.module_access) || [],
    member_count: Number(row.member_count ?? 0),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// All roles for the admin Roles card, with how many active accounts hold each.
export async function list() {
  const rows = await query(
    `SELECT r.id, r.name, r.module_access, r.created_at, r.updated_at,
            (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.deleted_at IS NULL) AS member_count
       FROM access_roles r
      ORDER BY r.name ASC`,
  );
  return rows.map(serializeRow);
}

// Resolve a role's granted module list (used when binding an invite/account to it).
// Throws 404 if the role no longer exists.
export async function moduleAccessForRole(roleId) {
  const rows = await query('SELECT id, module_access FROM access_roles WHERE id = ?', [roleId]);
  if (!rows.length) throw ApiError.notFound('role not found');
  return normalizeModuleAccess(rows[0].module_access) || [];
}

export async function create(adminId, { name, modules } = {}) {
  const cleanedName = cleanName(name);
  const cleanedModules = cleanModules(modules);
  try {
    const res = await query('INSERT INTO access_roles (name, module_access, created_by) VALUES (?, ?, ?)', [
      cleanedName,
      serializeModuleAccess(cleanedModules),
      adminId,
    ]);
    return { id: res.insertId, name: cleanedName, module_access: cleanedModules, member_count: 0 };
  } catch (err) {
    if (err?.code === 'ER_DUP_ENTRY') throw ApiError.conflict('a role with that name already exists');
    throw err;
  }
}

// Update a role's name and/or module access. When the module set changes, the new
// access is fanned out (in the same transaction) to every bound account and unused
// invite so the binding stays live.
export async function update(id, { name, modules } = {}) {
  const rows = await query('SELECT id, name FROM access_roles WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('role not found');

  const nextName = name === undefined ? undefined : cleanName(name);
  const nextModules = modules === undefined ? undefined : cleanModules(modules);
  if (nextName === undefined && nextModules === undefined) {
    throw ApiError.badRequest('nothing to update');
  }

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    if (nextName !== undefined && nextModules !== undefined) {
      await conn.query('UPDATE access_roles SET name = ?, module_access = ? WHERE id = ?', [
        nextName,
        serializeModuleAccess(nextModules),
        id,
      ]);
    } else if (nextName !== undefined) {
      await conn.query('UPDATE access_roles SET name = ? WHERE id = ?', [nextName, id]);
    } else {
      await conn.query('UPDATE access_roles SET module_access = ? WHERE id = ?', [serializeModuleAccess(nextModules), id]);
    }

    // Fan-out: keep every bound account + unused invite in sync with the role.
    if (nextModules !== undefined) {
      const serialized = serializeModuleAccess(nextModules);
      await conn.query('UPDATE users SET module_access = ? WHERE role_id = ? AND deleted_at IS NULL', [serialized, id]);
      await conn.query('UPDATE invites SET module_access = ? WHERE role_id = ? AND used_by IS NULL', [serialized, id]);
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (err?.code === 'ER_DUP_ENTRY') throw ApiError.conflict('a role with that name already exists');
    throw err;
  } finally {
    conn.release();
  }

  const [updated] = await list().then((all) => all.filter((r) => r.id === Number(id)));
  return updated || { id: Number(id), name: nextName ?? rows[0].name, module_access: nextModules ?? [] };
}

// Delete a role. Bound accounts/invites keep their current module_access (FK
// ON DELETE SET NULL just clears role_id → they become "Custom"), so nobody loses access.
export async function remove(id) {
  const res = await query('DELETE FROM access_roles WHERE id = ?', [id]);
  if (!res.affectedRows) throw ApiError.notFound('role not found');
  return { id: Number(id), deleted: true };
}
