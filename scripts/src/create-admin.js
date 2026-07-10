import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

// Bootstrap the first super admin (signup is invite-only, so this seeds the initial
// account owner who then invites everyone else).
//   npm run create-admin -- --name "Admin" --email admin@x.com --password secret123
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const name = flag('name') || process.env.ADMIN_NAME;
const email = flag('email') || process.env.ADMIN_EMAIL;
const password = flag('password') || process.env.ADMIN_PASSWORD;
const role = String(flag('role') || process.env.ADMIN_ROLE || 'super_admin').trim().toLowerCase();

if (!name || !email || !password) {
  console.error('usage: npm run create-admin -- --name "Admin" --email admin@example.com --password secret123');
  process.exit(1);
}
if (!['admin', 'super_admin'].includes(role)) {
  console.error('role must be admin or super_admin');
  process.exit(1);
}
if (String(password).length < 8) {
  console.error('password must be at least 8 characters');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (configure .env)');
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL);
const conn = await mysql.createConnection({
  host: url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
  ssl: String(process.env.DB_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
});

try {
  const hash = await bcrypt.hash(password, 10);
  await conn.beginTransaction();
  if (role === 'super_admin') {
    await conn.query("UPDATE users SET role = 'admin' WHERE role = 'super_admin' AND email <> ?", [email]);
  }
  const [existing] = await conn.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) {
    await conn.query(
      'UPDATE users SET role = ?, is_active = 1, deleted_at = NULL, password_hash = ?, name = ? WHERE email = ?',
      [role, hash, name, email],
    );
    console.log(`[create-admin] promoted existing user ${email} to ${role}.`);
  } else {
    const [res] = await conn.query(
      'INSERT INTO users (name, email, password_hash, role, is_active) VALUES (?, ?, ?, ?, 1)',
      [name, email, hash, role],
    );
    await conn.query('INSERT INTO posting_settings (user_id, owner_email) VALUES (?, ?)', [res.insertId, email]);
    console.log(`[create-admin] created ${role} ${email} (id ${res.insertId}).`);
  }
  await conn.commit();
} catch (err) {
  await conn.rollback().catch(() => {});
  console.error('[create-admin] failed:', err.message);
  process.exitCode = 1;
} finally {
  await conn.end();
}
