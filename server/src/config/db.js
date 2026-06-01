import mysql from 'mysql2/promise';
import { env } from './env.js';
import ApiError from '../utils/ApiError.js';

function buildConfig() {
  if (!env.databaseUrl) return null;
  const url = new URL(env.databaseUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    charset: 'utf8mb4',
    timezone: 'Z', // interpret/store DATETIME as UTC
    waitForConnections: true,
    connectionLimit: 10,
    // multipleStatements is intentionally OFF here (only the migration runner enables it).
    ssl: env.dbSsl ? { rejectUnauthorized: false } : undefined,
  };
}

const config = buildConfig();
export const pool = config ? mysql.createPool(config) : null;

// Thin helpers that fail loudly when the DB isn't configured.
export async function query(sql, params) {
  if (!pool) throw new ApiError(503, 'Database not configured (DATABASE_URL missing)');
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function getConnection() {
  if (!pool) throw new ApiError(503, 'Database not configured (DATABASE_URL missing)');
  return pool.getConnection();
}

export async function pingDb() {
  if (!pool) throw new Error('DATABASE_URL not configured');
  const conn = await pool.getConnection();
  try {
    await conn.ping();
  } finally {
    conn.release();
  }
}

export default pool;
