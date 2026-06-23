import pool from './db/pool.js';
import { MODULE_IDS, normalizeModuleAccess } from '../../server/src/config/modules.js';

function flag(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function usage() {
  console.error(
    'usage: npm run grant-module-access -- --email demo@example.com --module products',
  );
  console.error('   or: npm run grant-module-access -- demo@example.com products');
}

const positional = process.argv
  .slice(2)
  .filter((arg, index, args) => !arg.startsWith('--') && args[index - 1] !== '--email' && args[index - 1] !== '--module');

const email = String(flag('email') || positional[0] || process.env.DEMO_EMAIL || 'demo@example.com')
  .trim()
  .toLowerCase();
const moduleId = String(flag('module') || positional[1] || 'products').trim();

if (!email || !moduleId) {
  usage();
  process.exit(1);
}

if (!MODULE_IDS.includes(moduleId)) {
  console.error(`[grant-module-access] unknown module "${moduleId}". Valid modules: ${MODULE_IDS.join(', ')}`);
  process.exit(1);
}

function currentAccessList(value) {
  const access = normalizeModuleAccess(value);
  return access == null ? null : access;
}

async function main() {
  const [rows] = await pool.query(
    `SELECT id, name, email, role, module_access
       FROM users
      WHERE LOWER(email) = ? AND deleted_at IS NULL
      ORDER BY id ASC
      LIMIT 1`,
    [email],
  );

  const user = rows[0];
  if (!user) {
    throw new Error(`no active user found for ${email}`);
  }

  const before = currentAccessList(user.module_access);
  const next = before == null ? [...MODULE_IDS] : [...before];

  if (!next.includes(moduleId)) {
    next.push(moduleId);
  }

  await pool.query('UPDATE users SET module_access = ? WHERE id = ?', [JSON.stringify(next), user.id]);

  console.log(
    `[grant-module-access] ${user.name || user.email} (${user.email}) now has ${moduleId} access.`,
  );
  console.log(`[grant-module-access] module_access: ${JSON.stringify(next)}`);
}

main()
  .catch((err) => {
    console.error('[grant-module-access] failed:', err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
