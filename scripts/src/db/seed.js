import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pool from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(__dirname, '../../database/seed.sql');

async function main() {
  const seed = await readFile(seedPath, 'utf8');
  await pool.query(seed);
  console.log('[seed] seed data applied successfully.');
  await pool.end();
}

main().catch(async (err) => {
  console.error('[seed] failed:', err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
