// One-off: import the legacy single-page Facebook config (FACEBOOK_* env) into
// the platform_accounts table as the first connected page, encrypting its
// secrets, then backfill existing posts + every user's active page to it.
// Idempotent: skips the insert if a Facebook page already exists.
//
//   Run from the repo root (Node 18+):  npm run fb:import-env
//
// Requires ENCRYPTION_KEY (same key the server uses) + DATABASE_URL +
// FACEBOOK_PAGE_ID + FACEBOOK_PAGE_ACCESS_TOKEN, read from .env (root) or server/.env.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const env = { ...process.env };
  for (const file of [resolve(__dirname, '../../.env'), resolve(__dirname, '../../server/.env')]) {
    try {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && env[m[1]] === undefined) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
          env[m[1]] = v;
        }
      }
    } catch {
      /* file not present — try the next */
    }
  }
  return env;
}

const env = loadEnv();

// Mirror server/src/utils/crypto.util.js (AES-256-GCM, "iv.tag.ciphertext").
function keyBuf() {
  const k = env.ENCRYPTION_KEY;
  if (/^[0-9a-fA-F]{64}$/.test(k)) return Buffer.from(k, 'hex');
  const b64 = Buffer.from(k, 'base64');
  if (b64.length === 32) return b64;
  return crypto.createHash('sha256').update(String(k)).digest();
}
function encrypt(text) {
  if (text == null || text === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

async function main() {
  const missing = ['DATABASE_URL', 'ENCRYPTION_KEY', 'FACEBOOK_PAGE_ID', 'FACEBOOK_PAGE_ACCESS_TOKEN'].filter(
    (k) => !env[k],
  );
  if (missing.length) {
    console.error(`[fb:import-env] missing: ${missing.join(', ')} (.env or server/.env)`);
    process.exit(1);
  }

  const url = new URL(env.DATABASE_URL);
  const conn = await mysql.createConnection({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    ssl: String(env.DB_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const [existing] = await conn.execute(
      "SELECT id FROM platform_accounts WHERE platform_name = 'facebook' ORDER BY id ASC LIMIT 1",
    );
    let id;
    if (existing.length) {
      id = existing[0].id;
      console.log(`[fb:import-env] a Facebook page already exists (id ${id}) — skipping insert.`);
    } else {
      const [users] = await conn.execute("SELECT id FROM users ORDER BY (role='super_admin') DESC, (role='admin') DESC, id ASC LIMIT 1");
      if (!users.length) {
        console.error('[fb:import-env] no users in the database to own the page.');
        process.exit(1);
      }
      const [res] = await conn.execute(
        `INSERT INTO platform_accounts
           (user_id, platform_name, account_name, fb_page_id, app_id, app_secret, app_client_token, access_token, is_active)
         VALUES (?, 'facebook', ?, ?, ?, ?, ?, ?, 1)`,
        [
          users[0].id,
          env.FACEBOOK_PAGE_NAME || 'Imported page',
          env.FACEBOOK_PAGE_ID,
          env.FACEBOOK_APP_ID || null,
          encrypt(env.FACEBOOK_APP_SECRET),
          encrypt(env.FACEBOOK_APP_CLIENT_TOKEN),
          encrypt(env.FACEBOOK_PAGE_ACCESS_TOKEN),
        ],
      );
      id = res.insertId;
      console.log(`[fb:import-env] inserted page "${env.FACEBOOK_PAGE_NAME || 'Imported page'}" as id ${id}.`);
    }

    const [posts] = await conn.execute('UPDATE post_pool SET account_id = ? WHERE account_id IS NULL', [id]);
    const [setts] = await conn.execute(
      'UPDATE posting_settings SET selected_account_id = ? WHERE selected_account_id IS NULL',
      [id],
    );
    let insightRows = 0;
    try {
      const [ins] = await conn.execute('UPDATE page_insight_daily SET account_id = ? WHERE account_id IS NULL', [id]);
      insightRows = ins.affectedRows;
    } catch {
      /* migration 013 (page_insight_daily.account_id) not applied yet — skip */
    }
    console.log(
      `[fb:import-env] backfilled ${posts.affectedRows} post(s), ${setts.affectedRows} settings row(s), ${insightRows} insight row(s).`,
    );
    console.log('[fb:import-env] done.');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('[fb:import-env] failed:', e.message);
  process.exit(1);
});
