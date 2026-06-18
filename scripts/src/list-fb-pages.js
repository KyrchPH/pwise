import crypto from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pool from './db/pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

function keyBuf() {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) throw new Error('ENCRYPTION_KEY is not set');
  if (/^[0-9a-fA-F]{64}$/.test(key)) return Buffer.from(key, 'hex');
  const b64 = Buffer.from(key, 'base64');
  if (b64.length === 32) return b64;
  return crypto.createHash('sha256').update(String(key)).digest();
}

function decrypt(payload) {
  if (!payload) return null;
  const [ivB64, tagB64, dataB64] = String(payload).split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('malformed encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}

async function main() {
  const [rows] = await pool.query(
    `SELECT id, account_name, fb_page_id, access_token, is_active
       FROM platform_accounts
      WHERE platform_name = 'facebook'
      ORDER BY created_at ASC`,
  );

  const pages = rows.map((row) => {
    let accessToken = null;
    let accessTokenError = null;

    try {
      accessToken = decrypt(row.access_token);
    } catch (error) {
      accessTokenError = error.message;
    }

    return {
      record_id: row.id,
      name: row.account_name,
      id: row.fb_page_id,
      access_token: accessToken,
      is_active: !!row.is_active,
      ...(accessTokenError ? { access_token_error: accessTokenError } : {}),
    };
  });

  console.log(JSON.stringify(pages, null, 2));
}

main()
  .catch(async (error) => {
    console.error('[fb:list-pages] failed:', error.message);
    await pool.end().catch(() => {});
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
