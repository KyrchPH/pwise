import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../../database/schema.sql');

// Used by `--reset` (dev only): drop everything, then re-create from schema.
// FK checks are disabled so table drop order doesn't matter.
const DROP_SQL = `
  SET FOREIGN_KEY_CHECKS = 0;
  DROP TABLE IF EXISTS posting_logs;
  DROP TABLE IF EXISTS post_pool;
  DROP TABLE IF EXISTS posting_settings;
  DROP TABLE IF EXISTS platform_accounts;
  DROP TABLE IF EXISTS users;
  SET FOREIGN_KEY_CHECKS = 1;
`;

async function main() {
  const reset = process.argv.includes('--reset');
  if (reset) {
    console.log('[migrate] --reset: dropping existing tables…');
    await pool.query(DROP_SQL);
  }
  const schema = await readFile(schemaPath, 'utf8');
  await pool.query(schema);
  console.log('[migrate] schema applied successfully.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('[migrate] failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
