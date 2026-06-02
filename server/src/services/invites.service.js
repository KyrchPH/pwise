import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

function generateToken() {
  return crypto.randomBytes(24).toString('base64url'); // 32-char, URL-safe
}

// Admin generates a single-use sign-up link, recorded against their account.
export async function create(adminId) {
  const token = generateToken();
  await query('INSERT INTO invites (token, created_by) VALUES (?, ?)', [token, adminId]);
  return { token, link: `${env.clientUrl}/signup?token=${token}` };
}

// All invites with creator + redeemer info (for the admin Accounts tab).
export async function list() {
  return query(
    `SELECT i.id, i.token, i.created_at, i.used_at, i.expires_at,
            c.email AS created_by_email, c.name AS created_by_name,
            u.email AS used_by_email
     FROM invites i
     JOIN users c ON c.id = i.created_by
     LEFT JOIN users u ON u.id = i.used_by
     ORDER BY i.created_at DESC`,
  );
}

// Delete an UNUSED invite (race-safe: only deletes while used_by IS NULL).
export async function remove(id) {
  const res = await query('DELETE FROM invites WHERE id = ? AND used_by IS NULL', [id]);
  if (res.affectedRows) return { id: Number(id), deleted: true };
  const rows = await query('SELECT id FROM invites WHERE id = ?', [id]);
  if (rows.length) throw ApiError.conflict("this link has already been used and can't be deleted");
  throw ApiError.notFound('invite not found');
}

// Returns the invite if it can still be used; otherwise throws.
export async function findUsable(token) {
  if (!token) throw ApiError.badRequest('an invite token is required');
  const rows = await query('SELECT * FROM invites WHERE token = ?', [token]);
  const invite = rows[0];
  if (!invite) throw ApiError.notFound('invalid invite link');
  if (invite.used_by) throw new ApiError(410, 'this invite link has already been used');
  if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
    throw new ApiError(410, 'this invite link has expired');
  }
  return invite;
}

// Atomically claim a single-use invite inside a transaction. Returns false if
// another request already claimed it (race), so the caller can roll back.
export async function consume(conn, token, userId) {
  const [res] = await conn.query(
    'UPDATE invites SET used_by = ?, used_at = UTC_TIMESTAMP() WHERE token = ? AND used_by IS NULL',
    [userId, token],
  );
  return res.affectedRows === 1;
}
