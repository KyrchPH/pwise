import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, getConnection } from '../config/db.js';
import { env } from '../config/env.js';
import { moduleAccessForUser, serializeModuleAccess } from '../config/modules.js';
import ApiError from '../utils/ApiError.js';
import * as invitesService from './invites.service.js';
import * as mail from './mail.service.js';
import * as otp from './otp.service.js';
import * as s3 from './s3.service.js';

let jwtSecret = env.jwtSecret;
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[auth] JWT_SECRET missing — using an ephemeral secret (tokens invalid after restart).');
}

export function signToken(user, sessionId) {
  const payload = { sub: user.id, email: user.email };
  if (sessionId != null) payload.sid = Number(sessionId); // ties the token to a revocable session row
  return jwt.sign(payload, jwtSecret, { expiresIn: env.jwtExpiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, jwtSecret);
}

// ── Brute-force lockout + device trust ───────────────────────────────────────
const LOCK_MAX_ATTEMPTS = 5; // wrong passwords before the account locks
const LOCK_MINUTES = 30; // how long it stays locked (lazy auto-unlock)
const TRUST_DAYS = 30; // sliding lifetime of a "trusted device"

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// 423 with structured details so the client can show a precise "try again in N minutes".
function lockError(lockedUntil) {
  const minutesRemaining = Math.max(1, Math.ceil((lockedUntil.getTime() - Date.now()) / 60000));
  const plural = minutesRemaining === 1 ? '' : 's';
  return new ApiError(
    423,
    `Too many failed attempts — this account is locked. Try again in ${minutesRemaining} minute${plural}, or ask an admin to unlock it.`,
    { locked: true, unlockAt: lockedUntil.toISOString(), minutesRemaining },
  );
}

// Count a wrong password; lock the account once it reaches the limit. locked_until is
// computed in JS (the pool stores DATETIME as UTC) to match the rest of the auth code.
async function registerFailedLogin(row) {
  const attempts = (row.failed_login_attempts || 0) + 1;
  if (attempts >= LOCK_MAX_ATTEMPTS) {
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
    await query('UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?', [attempts, lockedUntil, row.id]);
  } else {
    await query('UPDATE users SET failed_login_attempts = ? WHERE id = ?', [attempts, row.id]);
  }
}

// A short-lived, session-less JWT proving "this user just passed the password step" —
// carried by the client between /auth/login and /auth/login/verify. It has no `sid`, so
// resolveSession rejects it on protected routes (it can't be used as a real token).
export function signLoginChallenge(userId) {
  return jwt.sign({ sub: Number(userId), purpose: 'login_challenge' }, jwtSecret, { expiresIn: '10m' });
}

export function verifyLoginChallenge(token) {
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    throw new ApiError(410, 'your login attempt expired — please sign in again');
  }
  if (payload.purpose !== 'login_challenge' || !payload.sub) throw ApiError.unauthorized('invalid login challenge');
  return Number(payload.sub);
}

// True if `deviceToken` matches a live trusted device for this user; also slides its
// 30-day expiry forward. Never bypasses the password — only the OTP.
async function touchTrustedDevice(userId, deviceToken, ctx = {}) {
  if (!deviceToken) return false;
  const rows = await query(
    'SELECT id FROM trusted_devices WHERE user_id = ? AND token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()',
    [userId, sha256(deviceToken)],
  );
  if (!rows.length) return false;
  const expiresAt = new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000);
  await query('UPDATE trusted_devices SET last_used_at = NOW(), expires_at = ?, ip = ? WHERE id = ?', [
    expiresAt,
    String(ctx.ip || '').slice(0, 64) || null,
    rows[0].id,
  ]).catch(() => {});
  return true;
}

// Issue a new trusted-device secret: store only its SHA-256, hand the raw secret back
// for the client to keep in localStorage.
async function mintTrustedDevice(userId, ctx = {}) {
  const secret = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + TRUST_DAYS * 24 * 60 * 60 * 1000);
  await query(
    'INSERT INTO trusted_devices (user_id, token_hash, label, ip, last_used_at, expires_at) VALUES (?, ?, ?, ?, NOW(), ?)',
    [userId, sha256(secret), String(ctx.userAgent || '').slice(0, 255) || null, String(ctx.ip || '').slice(0, 64) || null, expiresAt],
  );
  return secret;
}

// Revoke every trusted device for a user (they'll need the OTP again next login). Used
// by "log out of all other devices" and after a password change.
async function revokeTrustedDevices(userId) {
  await query('UPDATE trusted_devices SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId]);
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
export async function register({ name, email, password, token } = {}, ctx = {}) {
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
    const sessionId = await createSession(user.id, ctx);
    return { user, token: signToken(user, sessionId) };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Step 1 of login. Returns EITHER a finished session `{ user, token }` (trusted device)
// OR an OTP challenge `{ otpRequired, email, expiresInMinutes, challengeToken }` (new
// device). Wrong password / unknown email both return the same generic 401 (no
// enumeration); a locked account returns 423 with details.
export async function login({ email, password, deviceToken } = {}, ctx = {}) {
  if (!email || !password) throw ApiError.badRequest('email and password are required');
  const rows = await query('SELECT * FROM users WHERE email = ?', [email]);
  const row = rows[0];
  if (!row) throw ApiError.unauthorized('invalid credentials');

  // 1) Lock check BEFORE the password compare. A future lock refuses the login; an
  //    elapsed lock auto-unlocks (clearing the counter so the user gets a fresh 5 tries).
  if (row.locked_until) {
    const lockedUntil = new Date(row.locked_until);
    if (lockedUntil.getTime() > Date.now()) throw lockError(lockedUntil);
    await query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [row.id]);
    row.failed_login_attempts = 0;
    row.locked_until = null;
  }

  // 2) Verify the password; a miss counts toward the lockout.
  const ok = await bcrypt.compare(password, row.password_hash);
  if (!ok) {
    await registerFailedLogin(row);
    throw ApiError.unauthorized('invalid credentials');
  }

  // 3) Deactivated/deleted accounts can't log in (checked after the password so account
  //    state isn't leaked to someone who doesn't know it).
  if (row.deleted_at || !row.is_active) throw ApiError.forbidden('this account has been deactivated');

  // 4) Correct password → clear any lingering failed-attempt state.
  if (row.failed_login_attempts) {
    await query('UPDATE users SET failed_login_attempts = 0 WHERE id = ?', [row.id]);
  }

  // 5) A trusted device skips the OTP — issue the session straight away.
  if (await touchTrustedDevice(row.id, deviceToken, ctx)) {
    const user = await publicUser(row);
    const sessionId = await createSession(user.id, ctx);
    return { user, token: signToken(user, sessionId) };
  }

  // 6) Otherwise email a one-time code and hand back a short-lived challenge.
  const { email: masked, expiresInMinutes } = await otp.issue(row.id, 'login');
  return { otpRequired: true, email: masked, expiresInMinutes, challengeToken: signLoginChallenge(row.id) };
}

// Step 2 of login (new device): verify the emailed code carried by the challenge, then
// issue the real session. Optionally remembers this device so future logins skip the OTP.
export async function verifyLogin({ challengeToken, code, trustDevice } = {}, ctx = {}) {
  const userId = verifyLoginChallenge(challengeToken);
  await otp.verify(userId, 'login', code); // throws (410/429/400) on bad/expired/too-many

  const rows = await query('SELECT * FROM users WHERE id = ?', [userId]);
  const row = rows[0];
  if (!row || row.deleted_at || !row.is_active) throw ApiError.forbidden('this account has been deactivated');

  // Mint the trusted device BEFORE creating the session so a failure here doesn't leave a
  // dangling session; the raw secret is returned once for the client to store.
  const newDeviceToken = trustDevice ? await mintTrustedDevice(userId, ctx) : undefined;
  await otp.consume(userId, 'login');

  const user = await publicUser(row);
  const sessionId = await createSession(user.id, ctx);
  const result = { user, token: signToken(user, sessionId) };
  if (newDeviceToken) result.deviceToken = newDeviceToken;
  return result;
}

// Re-send the login code without touching the password/lockout path (the challenge
// already proves the password step passed). Respects the OTP resend cooldown.
export async function resendLogin({ challengeToken } = {}) {
  const userId = verifyLoginChallenge(challengeToken);
  const { email, expiresInMinutes } = await otp.issue(userId, 'login');
  return { sent: true, email, expiresInMinutes };
}

export async function getById(id) {
  const rows = await query('SELECT * FROM users WHERE id = ?', [id]);
  return publicUser(rows[0]);
}

// Name-only. Email is intentionally NOT editable here — changing it requires the
// OTP flow below, so this endpoint can't be used to bypass that verification.
export async function updateProfile(userId, { name } = {}) {
  const nextName = String(name ?? '').trim();
  if (!nextName) throw ApiError.badRequest('name is required');
  if (nextName.length > 255) throw ApiError.badRequest('name is too long (max 255 characters)');

  await query('UPDATE users SET name = ? WHERE id = ?', [nextName, userId]);
  return getById(userId);
}

// ── Email-verified email change ──────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Step 1 — validate the requested new email, then email a code to the CURRENT address
// (so a hijacked session can't silently move the account to an attacker's inbox). The
// pending new email rides along in the code row's payload.
export async function startEmailChange(userId, newEmail) {
  const nextEmail = String(newEmail ?? '').trim().toLowerCase();
  if (!nextEmail) throw ApiError.badRequest('enter the new email address');
  if (!EMAIL_RE.test(nextEmail)) throw ApiError.badRequest('enter a valid email address');

  const users = await query('SELECT email FROM users WHERE id = ?', [userId]);
  const current = users[0];
  if (!current) throw ApiError.unauthorized('not authenticated');
  if (nextEmail === String(current.email).toLowerCase()) throw ApiError.badRequest('that is already your email address');

  const taken = await query('SELECT id FROM users WHERE email = ? AND id <> ?', [nextEmail, userId]);
  if (taken.length) throw ApiError.conflict('email already registered');

  const res = await otp.issue(userId, 'email_change', { payload: { newEmail: nextEmail } });
  return { sent: true, email: res.email, newEmail: nextEmail, expiresInMinutes: res.expiresInMinutes };
}

// Step 2 — verify the code and apply the change, re-checking uniqueness inside a
// transaction (the target email could get taken during the 10-minute window).
export async function completeEmailChange(userId, code) {
  const { payload } = await otp.verify(userId, 'email_change', code);
  const newEmail = String(payload?.newEmail ?? '').trim().toLowerCase();
  if (!newEmail || !EMAIL_RE.test(newEmail)) throw ApiError.badRequest('no pending email change — start again');

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [taken] = await conn.query('SELECT id FROM users WHERE email = ? AND id <> ?', [newEmail, userId]);
    if (taken.length) throw ApiError.conflict('email already registered');
    const [rows] = await conn.query('SELECT email FROM users WHERE id = ?', [userId]);
    const oldEmail = rows[0]?.email;
    await conn.query('UPDATE users SET email = ? WHERE id = ?', [newEmail, userId]);
    await conn.query('DELETE FROM auth_otp_codes WHERE user_id = ? AND purpose = ?', [userId, 'email_change']);
    await conn.commit();
    notifyEmailChanged(oldEmail, newEmail); // best-effort, fire-and-forget
    return getById(userId);
  } catch (err) {
    await conn.rollback();
    if (err && err.code === 'ER_DUP_ENTRY') throw ApiError.conflict('email already registered');
    throw err;
  } finally {
    conn.release();
  }
}

// Courtesy "your email was changed" notice to the OLD address (best-effort — never
// blocks the change, and stays quiet in dev where SMTP may be unconfigured).
async function notifyEmailChanged(oldEmail, newEmail) {
  if (!oldEmail) return;
  const subject = 'Your pwise email address was changed';
  const text = `The email address on your pwise account was just changed to ${newEmail}.\n\nIf this was you, no action is needed. If not, contact an administrator immediately.`;
  const html = `<p>The email address on your pwise account was just changed to <strong>${newEmail}</strong>.</p><p>If this was you, no action is needed. If not, contact an administrator immediately.</p>`;
  try {
    await mail.sendMail({ to: oldEmail, subject, text, html });
  } catch {
    /* best-effort */
  }
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

// Record a login as a revocable SESSION row; the JWT carries its id (sid). Returns the
// new id so the token can embed it. Each login = one session = one row in the history.
export async function createSession(userId, { ip, userAgent } = {}) {
  const res = await query(
    'INSERT INTO login_history (user_id, ip, user_agent, last_seen_at) VALUES (?, ?, ?, NOW())',
    [userId, String(ip || '').slice(0, 64) || null, String(userAgent || '').slice(0, 512) || null],
  );
  return res.insertId;
}

// Verify a bearer token AND its session: the token's session (sid) must still exist and
// not be revoked — this is what makes "log out of this / other devices" take effect.
// Throws on a malformed/expired token (verifyToken); returns null otherwise (no user or
// session, or revoked). On success returns { user, sessionId }. Bumps last_seen_at at
// most once a minute so it's not a write per request. Shared by requireAuth + SSE.
export async function resolveSession(token) {
  const payload = verifyToken(token);
  const user = await findActiveById(payload.sub);
  if (!user) return null;
  const sid = payload.sid != null ? Number(payload.sid) : null;
  if (!sid) return null; // legacy tokens without a session id are no longer accepted
  const rows = await query(
    'SELECT id, revoked_at, last_seen_at FROM login_history WHERE id = ? AND user_id = ?',
    [sid, user.id],
  );
  const s = rows[0];
  if (!s || s.revoked_at) return null;
  if (!s.last_seen_at || Date.now() - new Date(s.last_seen_at).getTime() > 60_000) {
    await query('UPDATE login_history SET last_seen_at = NOW() WHERE id = ?', [sid]).catch(() => {});
  }
  return { user, sessionId: sid };
}

// Revoke ONE session (log out a specific device). Scoped to the owner.
export async function revokeSession(userId, sessionId) {
  const res = await query(
    'UPDATE login_history SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
    [Number(sessionId), userId],
  );
  return { revoked: res.affectedRows > 0 };
}

// Revoke every session EXCEPT the current one (log out of all other devices). Also
// clears device trust, so any lost/other device must pass the email OTP again next
// login (the current session's token stays valid).
export async function logoutOtherSessions(userId, currentSessionId) {
  await query(
    'UPDATE login_history SET revoked_at = NOW() WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
    [userId, Number(currentSessionId) || 0],
  );
  await revokeTrustedDevices(userId);
  return { ok: true };
}

// The user's sessions (active + revoked), newest first — powers the Security list.
export async function listSessions(userId, limit = 100) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);
  const rows = await query(
    `SELECT id, ip, user_agent, created_at, last_seen_at, revoked_at FROM login_history
      WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ${lim}`,
    [userId],
  ).catch(() => []);
  return rows.map((r) => ({
    id: r.id,
    ip: r.ip || '',
    userAgent: r.user_agent || '',
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    revokedAt: r.revoked_at,
  }));
}

// ── Email-verified password change ───────────────────────────────────────────
// Three steps, all for the signed-in user: confirm current password (emails a
// code), verify the code, then set the new password. The code lives hashed in
// password_change_codes (one pending row per user), expiring after CODE_TTL_MIN.
const CODE_TTL_MIN = 10;
const MAX_CODE_ATTEMPTS = 5;

// Code generation + email masking are shared with the login/email-change OTP flows.
const { generateCode, maskEmail } = otp;

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
  // A new password invalidates device trust everywhere — every device must re-OTP.
  await revokeTrustedDevices(userId);
  return { changed: true };
}
