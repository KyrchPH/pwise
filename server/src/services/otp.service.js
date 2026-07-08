import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import * as mail from './mail.service.js';

// Generic one-time email codes for sensitive auth actions, backed by auth_otp_codes
// (one pending code per (user_id, purpose)). Modeled on the password-change flow:
// a 6-digit code, stored bcrypt-hashed, expiring after CODE_TTL_MIN, with a per-code
// attempt cap. A short resend cooldown prevents inbox-bombing: a repeat request inside
// the window reuses the still-valid pending code (no new email) instead of regenerating.

export const CODE_TTL_MIN = 10;
export const MAX_CODE_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60_000;

// Per-purpose email copy. Only the two purposes we issue codes for.
const TEMPLATES = {
  login: {
    subject: 'Your pwise login code',
    line: 'Your login verification code is',
    tail: "If you didn't try to sign in, someone may have your password — change it after you log in.",
  },
  email_change: {
    subject: 'Confirm your pwise email change',
    line: 'Your email-change verification code is',
    tail: "If you didn't request this, you can ignore this email — your address stays the same.",
  },
};

export function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0'); // 6 digits
}

// "demo@example.com" -> "de***@example.com" (for a reassuring "sent to …" message).
export function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  if (!domain) return email || '';
  const head = user.length <= 2 ? user.slice(0, 1) : user.slice(0, 2);
  return `${head}${'*'.repeat(3)}@${domain}`;
}

// mysql2 may hand JSON columns back as an object or a string depending on driver/config.
function parsePayload(payload) {
  if (payload == null) return null;
  if (typeof payload === 'object') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

// Send a code email; in dev (no SMTP) log it to the console so the flow stays testable.
async function sendCode({ to, name, purpose, code, ttlMin }) {
  const t = TEMPLATES[purpose] || TEMPLATES.login;
  const text = `Hi ${name || ''},\n\n${t.line} ${code}.\nIt expires in ${ttlMin} minutes.\n\n${t.tail}`;
  const html = `<p>Hi ${name || ''},</p><p>${t.line}:</p><p style="font-size:26px;font-weight:bold;letter-spacing:4px;margin:8px 0">${code}</p><p>It expires in ${ttlMin} minutes. ${t.tail}</p>`;
  try {
    await mail.sendMail({ to, subject: t.subject, text, html });
  } catch (err) {
    if (mail.mailEnabled()) throw err; // SMTP configured but the send failed → surface it
    console.warn(`[otp] SMTP not configured — ${purpose} code for ${to} is ${code}`);
  }
}

// Issue (or reuse) a pending code for (userId, purpose) and email it to the user's
// CURRENT address. Within the resend cooldown a still-valid pending code is reused
// (no new email) so rapid re-requests can't bomb the inbox and a fresh login challenge
// can still be satisfied by the code already sent. Returns { email: masked, expiresInMinutes }.
export async function issue(userId, purpose, { payload = null, ttlMin = CODE_TTL_MIN } = {}) {
  const users = await query('SELECT id, name, email FROM users WHERE id = ?', [userId]);
  const user = users[0];
  if (!user) throw ApiError.unauthorized('not authenticated');

  const rows = await query('SELECT expires_at, verified, created_at FROM auth_otp_codes WHERE user_id = ? AND purpose = ?', [userId, purpose]);
  const pending = rows[0];
  const now = Date.now();
  const stillValid = pending && !pending.verified && new Date(pending.expires_at).getTime() > now;
  if (stillValid && now - new Date(pending.created_at).getTime() < RESEND_COOLDOWN_MS) {
    // A fresh code was just emailed — reuse it rather than sending another.
    return { email: maskEmail(user.email), expiresInMinutes: ttlMin, reused: true };
  }

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(now + ttlMin * 60 * 1000);
  // created_at doubles as "issued at" (drives the cooldown), so stamp it on every
  // regeneration — including the ON DUPLICATE path where it wouldn't refresh on its own.
  await query(
    `INSERT INTO auth_otp_codes (user_id, purpose, code_hash, expires_at, verified, attempts, payload, created_at)
       VALUES (?, ?, ?, ?, 0, 0, ?, NOW())
     ON DUPLICATE KEY UPDATE code_hash = VALUES(code_hash), expires_at = VALUES(expires_at),
       verified = 0, attempts = 0, payload = VALUES(payload), created_at = NOW()`,
    [userId, purpose, codeHash, expiresAt, payload != null ? JSON.stringify(payload) : null],
  );

  await sendCode({ to: user.email, name: user.name, purpose, code, ttlMin });
  return { email: maskEmail(user.email), expiresInMinutes: ttlMin };
}

// Validate a submitted code for (userId, purpose). Throws (410 expired / 429 too many /
// 400 wrong or none) on failure; on success returns the row's payload. Does NOT delete
// the row — call consume() once the guarded action has succeeded.
export async function verify(userId, purpose, code) {
  const value = String(code ?? '').trim();
  if (!value) throw ApiError.badRequest('enter the code from your email');
  const rows = await query('SELECT * FROM auth_otp_codes WHERE user_id = ? AND purpose = ?', [userId, purpose]);
  const row = rows[0];
  if (!row) throw ApiError.badRequest('no active request — start again');
  if (new Date(row.expires_at).getTime() < Date.now()) throw new ApiError(410, 'this code has expired — start again');
  if (row.attempts >= MAX_CODE_ATTEMPTS) throw new ApiError(429, 'too many incorrect attempts — start again');
  const ok = await bcrypt.compare(value, row.code_hash);
  if (!ok) {
    await query('UPDATE auth_otp_codes SET attempts = attempts + 1 WHERE user_id = ? AND purpose = ?', [userId, purpose]);
    throw ApiError.badRequest('that code is incorrect');
  }
  return { payload: parsePayload(row.payload) };
}

// Delete the pending code for (userId, purpose) after the guarded action succeeds.
export async function consume(userId, purpose) {
  await query('DELETE FROM auth_otp_codes WHERE user_id = ? AND purpose = ?', [userId, purpose]);
}
