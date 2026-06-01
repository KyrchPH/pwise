import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query, getConnection } from '../config/db.js';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

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

export async function register({ name, email, password }) {
  if (!name || !email || !password) throw ApiError.badRequest('name, email and password are required');
  if (String(password).length < 8) throw ApiError.badRequest('password must be at least 8 characters');

  const existing = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) throw ApiError.conflict('email already registered');

  const hash = await bcrypt.hash(password, 10);
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email, hash],
    );
    const userId = result.insertId;
    // Every user gets a default settings row (matches plan: create on registration).
    await conn.query('INSERT INTO posting_settings (user_id, owner_email) VALUES (?, ?)', [userId, email]);
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
  const user = publicUser(row);
  return { user, token: signToken(user) };
}

export async function getById(id) {
  const rows = await query('SELECT * FROM users WHERE id = ?', [id]);
  return publicUser(rows[0]);
}
