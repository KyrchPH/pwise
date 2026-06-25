import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, getConnection } from '../config/db.js';
import { env } from '../config/env.js';
import { moduleAccessForUser, serializeModuleAccess } from '../config/modules.js';
import ApiError from '../utils/ApiError.js';
import * as invitesService from './invites.service.js';
import * as mail from './mail.service.js';
import * as s3 from './s3.service.js';

let jwtSecret = env.jwtSecret;
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET missing — using an ephemeral secret (tokens invalid after restart).');
}

export function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, jwtSecret, { expiresIn: env.jwtExpiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

async function publicUser(row) {
  if (!row) return null;
  const { password_hash, avatar_s3_key, ...rest } = row;
  let avatarUrl = '';
  if (avatar_s3_key) {
    try {
      avatarUrl = await s3.createDownloadUrl(avatar_s3_key);
    } catch {
      // Login/profile should still work if S3 is temporarily unavailable.
    }
  }
  return { ...rest, avatar_url: avatarUrl, module_access: moduleAccessForUser(row) };
}

// Registration is invite-only: a valid single-use token is required and is consumed
// atomically with the account creation — or with REVIVING a soft-deleted account that
// re-registers the same email (same id, so its history comes back; see below).
export async function register({ name, email, password, token }) {
  if (!name || !email || !password) throw ApiError.badRequest('name, email and password are required');
  if (String(password).length < 8) throw ApiError.badRequest('password must be at least 8 characters');

  const invite = await invitesService.findUsable(token); // throws if missing/used/expired
  const inviteModules = moduleAccessForUser(invite);

  // A soft-deleted account still owns its email (it's UNIQUE). Re-registering that
  // email with a valid invite REVIVES the same row — same user id, so the person's
  // past conversations / notes / assignments come back — with a fresh name, password,
  // and access. A live (not-deleted) account still blocks the email.
  const existing = await query('SELECT id, deleted_at FROM users WHERE email = ?', [email]);
  if (existing.length && !existing[0].deleted_at) throw ApiError.conflict('email already registered');
  const reviveId = existing.length ? existing[0].id : null;

  const hash = await bcrypt.hash(password, 10);
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    let userId;
    if (reviveId != null) {
      // Revive on the same id, clearing the soft-delete. role is forced to 'user' so a
      // deleted admin can't come back as admin through a non-admin invite link.
      userId = reviveId;
      await conn.query(
        "UPDATE users SET name = ?, password_hash = ?, module_access = ?, role = 'user', is_active = 1, deleted_at = NULL WHERE id = ?",
        [name, hash, serializeModuleAccess(inviteModules), userId],
      );
      // The 1:1 settings row already exists from the original signup; keep/refresh it.
      await conn.query(
        'INSERT INTO posting_settings (user_id, owner_email) VALUES (?, ?) ON DUPLICATE KEY UPDATE owner_email = ?',
        [userId, email, email],
      );
    } else {
      const [result] = await conn.query(
        'INSERT INTO users (name, email, password_hash, module_access) VALUES (?, ?, ?, ?)',
        [name, email, hash, serializeModuleAccess(inviteModules)],
      );
      userId = result.insertId;
      await conn.query('INSERT INTO posting_settings (user_id, owner_email) VALUES (?, ?)', [userId, email]);
    }

    const claimed = await invitesService.consume(conn, token, userId);
    if (!claimed) throw new ApiError(410, 'this invite link has already been used');

    await conn.commit();
    const [rows] = await conn.query('SELECT * FROM users WHERE id = ?', [userId]);
    const user = await publicUser(rows[0]);
    return { user, token: signToken(user) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function login({ email, password }) {
  if (!email || !password) throw ApiError.badRequest('email and password are required');
  const rows = await query('SELECT * FROM users WHERE email = ?', [email]);
  const row = rows[0];
  if (!row) throw ApiError.unauthorized('invalid credentials');

  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) throw ApiError.unauthorized('invalid credentials');
  if (row.deleted_at || !row.is_active) throw ApiError.forbidden('this account has been deactivated');

  const user = await publicUser(row);
  return { user, token: signToken(user) };
}

export async function getById(id) {
  const rows = await query('SELECT * FROM users WHERE id = ?', [id]);
  return publicUser(rows[0]);
}

export async function updateProfile(userId, { name, email } = {}) {
  const nextName = String(name ?? '').trim();
  const nextEmail = String(email ?? '').trim().toLowerCase();
  if (!nextName) throw ApiError.badRequest('name is required');
  if (nextName.length > 255) throw ApiError.badRequest('name is too long (max 255 characters)');
  if (!nextEmail) throw ApiError.badRequest('email is required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) throw ApiError.badRequest('enter a valid email address');

  const existing = await query('SELECT id FROM users WHERE email = ? AND id <> ?', [nextEmail, userId]);
  if (existing.length) throw ApiError.conflict('email already registered');

  await query('UPDATE users SET name = ?, email = ? WHERE id = ?', [nextName, nextEmail, userId]);
  return getById(userId);
}

export async function updateAvatar(userId, { s3Key } = {}) {
  const key = String(s3Key ?? '').trim();
  if (!key) throw ApiError.badRequest('avatar s3Key is required');
  if (!key.startsWith(`avatars/${userId}/`)) throw ApiError.badRequest('invalid avatar upload');

  const head = await s3.headObject(key);
  if (!head.exists) throw ApiError.badRequest('avatar upload was not found');
  if (!String(head.contentType || '').startsWith('image/')) {
    throw ApiError.badRequest('avatar must be an image');
  }

  const rows = await query('SELECT avatar_s3_key FROM users WHERE id = ?', [userId]);
  if (!rows.length) throw ApiError.unauthorized('not authenticated');
  const previousKey = rows[0].avatar_s3_key;

  await query('UPDATE users SET avatar_s3_key = ? WHERE id = ?', [key, userId]);
  if (previousKey && previousKey !== key) await s3.deleteObject(previousKey);
  return getById(userId);
}

// Used by requireAuth on every request, so deactivation/deletion takes effect
// immediately (the user's existing token stops working).
export async function findActiveById(id) {
  const rows = await query('SELECT id, name, email, role, is_active, deleted_at, module_access FROM users WHERE id = ?', [id]);
  const row = rows[0];
  if (!row || row.deleted_at || !row.is_active) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    is_active: !!row.is_active,
    module_access: moduleAccessForUser(row),
  };
}

// ── Email-verified password change ───────────────────────────────────────────
// Three steps, all for the signed-in user: confirm current password (emails a
// code), verify the code, then set the new password. The code lives hashed in
// password_change_codes (one pending row per user), expiring after CODE_TTL_MIN.
const CODE_TTL_MIN = 10;
const MAX_CODE_ATTEMPTS = 5;

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); // 6 digits
}

// "demo@example.com" -> "de***@example.com" (for a reassuring "sent to …" message).
function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return email || '';
  const head = user.length <= 2 ? user.slice(0, 1) : user.slice(0, 2);
  return `${head}${'*'.repeat(3)}@${domain}`;
}

// Step 1 — verify the current password, then generate + email a one-time code.
export async function startPasswordChange(userId, currentPassword) {
  if (!currentPassword) throw ApiError.badRequest('your current password is required');
  const rows = await query('SELECT * FROM users WHERE id = ?', [userId]);
  const user = rows[0];
  if (!user) throw ApiError.unauthorized('not authenticated');
  const ok = await bcrypt.compare(currentPassword, user.password_hash);
  if (!ok) throw ApiError.badRequest('your current password is incorrect');

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN * 60 * 1000);
  // One pending code per user — a fresh request replaces any previous one.
  await query(
    `INSERT INTO password_change_codes (user_id, code_hash, expires_at, verified, attempts)
       VALUES (?, ?, ?, 0, 0)
     ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), expires_at = VALUES(expires_at), verified = 0, attempts = 0`,
    [userId, codeHash, expiresAt],
  );

  const subject = 'Your pwise password-change code';
  const text = `Hi ${user.name || ''},\n\nYour password-change verification code is ${code}.\nIt expires in ${CODE_TTL_MIN} minutes.\n\nIf you didn't request a password change, ignore this email — your password stays the same.`;
  const html = `<p>Hi ${user.name || ''},</p><p>Your password-change verification code is:</p><p style="font-size:26px;font-weight:bold;letter-spacing:4px;margin:8px 0">${code}</p><p>It expires in ${CODE_TTL_MIN} minutes. If you didn't request a password change, you can ignore this email.</p>`;
  try {
    await mail.sendMail({ to: user.email, subject, text, html });
  } catch (err) {
    if (mail.mailEnabled()) throw err; // SMTP configured but the send failed → surface it
    // No SMTP (dev): log the code so the flow is still testable locally.
    console.warn(`[auth] SMTP not configured — password-change code for ${user.email} is ${code}`);
  }
  return { sent: true, email: maskEmail(user.email), expiresInMinutes: CODE_TTL_MIN };
}

// Step 2 — verify the emailed code (marks the pending request as verified).
export async function verifyPasswordCode(userId, code) {
  const value = String(code ?? '').trim();
  if (!value) throw ApiError.badRequest('enter the code from your email');
  const rows = await query('SELECT * FROM password_change_codes WHERE user_id = ?', [userId]);
  const row = rows[0];
  if (!row) throw ApiError.badRequest('no active request — confirm your current password again');
  if (new Date(row.expires_at) < new Date()) throw new ApiError(410, 'this code has expired — start again');
  if (row.attempts >= MAX_CODE_ATTEMPTS) throw new ApiError(429, 'too many incorrect attempts — start again');
  const ok = await bcrypt.compare(value, row.code_hash);
  if (!ok) {
    await query('UPDATE password_change_codes SET attempts = attempts + 1 WHERE user_id = ?', [userId]);
    throw ApiError.badRequest('that code is incorrect');
  }
  await query('UPDATE password_change_codes SET verified = 1 WHERE user_id = ?', [userId]);
  return { verified: true };
}

// Step 3 — set the new password (requires a verified, unexpired code).
export async function completePasswordChange(userId, newPassword) {
  const pw = String(newPassword ?? '');
  if (pw.length < 8) throw ApiError.badRequest('your new password must be at least 8 characters');
  const rows = await query('SELECT * FROM password_change_codes WHERE user_id = ?', [userId]);
  const row = rows[0];
  if (!row || !row.verified) throw ApiError.badRequest('verify the emailed code first');
  if (new Date(row.expires_at) < new Date()) throw new ApiError(410, 'your verification expired — start again');

  const users = await query('SELECT password_hash FROM users WHERE id = ?', [userId]);
  if (!users.length) throw ApiError.unauthorized('not authenticated');
  if (await bcrypt.compare(pw, users[0].password_hash)) {
    throw ApiError.badRequest('your new password must be different from your current one');
  }

  const hash = await bcrypt.hash(pw, 10);
  await query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, userId]);
  await query('DELETE FROM password_change_codes WHERE user_id = ?', [userId]);
  return { changed: true };
}
