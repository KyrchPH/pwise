import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, getConnection } from '../config/db.js';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import * as invitesService from './invites.service.js';

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

function publicUser(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

// Registration is invite-only: a valid single-use token is required and is
// consumed atomically with the account creation.
export async function register({ name, email, password, token }) {
  if (!name || !email || !password) throw ApiError.badRequest('name, email and password are required');
  if (String(password).length < 8) throw ApiError.badRequest('password must be at least 8 characters');

  await invitesService.findUsable(token); // throws if missing/used/expired

  const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) throw ApiError.conflict('email already registered');

  const hash = await bcrypt.hash(password, 10);
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)', [name, email, hash]);
    const userId = result.insertId;
    await conn.query('INSERT INTO posting_settings (user_id, owner_email) VALUES (?, ?)', [userId, email]);

    const claimed = await invitesService.consume(conn, token, userId);
    if (!claimed) throw new ApiError(410, 'this invite link has already been used');

    await conn.commit();
    const [rows] = await conn.query('SELECT * FROM users WHERE id = ?', [userId]);
    const user = publicUser(rows[0]);
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

  const user = publicUser(row);
  return { user, token: signToken(user) };
}

export async function getById(id) {
  const rows = await query('SELECT * FROM users WHERE id = ?', [id]);
  return publicUser(rows[0]);
}

// Used by requireAuth on every request, so deactivation/deletion takes effect
// immediately (the user's existing token stops working).
export async function findActiveById(id) {
  const rows = await query('SELECT id, name, email, role, is_active, deleted_at FROM users WHERE id = ?', [id]);
  const row = rows[0];
  if (!row || row.deleted_at || !row.is_active) return null;
  return { id: row.id, name: row.name, email: row.email, role: row.role, is_active: !!row.is_active };
}
