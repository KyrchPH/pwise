import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from './pool.js';

// Runs an arbitrary .sql file (path relative to the scripts/ workspace root).
const __dirname = dirname(fileURLToPath(import.meta.url));
const arg = process.argv[2];
if (!arg) {
  console.error('usage: node src/db/apply.js <path-to-sql relative to scripts/>');
  process.exit(1);
}
const file = resolve(__dirname, '../../', arg);

async function main() {
  const sql = await readFile(file, 'utf8');
  await pool.query(sql);
  console.log(`[apply] ${arg} applied successfully.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error('[apply] failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
