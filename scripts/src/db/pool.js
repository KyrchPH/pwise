import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

// Load the shared root .env (scripts/src/db -> repo root).
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../../.env') });

if (!process.env.DATABASE_URL) {
  console.error(
    '[db] DATABASE_URL is not set. Copy .env.example to .env and set it ' +
      '(e.g. mysql://user:pass@your-ec2-host:3306/auto_post_agent).',
  );
  process.exit(1);
}

const url = new URL(process.env.DATABASE_URL);
const useSsl = String(process.env.DB_SSL).toLowerCase() === 'true';

// NOTE: multipleStatements is enabled because the migration/seed runners
// execute .sql files containing many statements. The application server's
// own pool (added in the server phase) must NOT enable this.
export const pool = mysql.createPool({
  host: url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.replace(/^\//, ''),
  charset: 'utf8mb4',
  multipleStatements: true,
  waitForConnections: true,
  connectionLimit: 5,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

export default pool;
