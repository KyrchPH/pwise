import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import {
  DeleteObjectsCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEMO_DEFAULTS = {
  name: 'Demo Admin',
  email: 'demo@example.com',
  passwordHash: '$2a$10$x17y.GCSS07n/xwK6AhLzug5CkHpbAGw1ZU85OBAVyf8QJwbXQWzG',
  role: 'admin',
};

const TABLES_TO_TRUNCATE = [
  'messages',
  'conversations',
  'vault_items',
  'page_insight_daily',
  'post_insight_history',
  'post_activity_log',
  'posting_logs',
  'post_pool',
  'creatomate_templates',
  'platform_accounts',
  'content_notes',
  'password_change_codes',
  'invites',
  'posting_settings',
  'users',
];

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
      /* file not present */
    }
  }
  return env;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function flag(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function requireFlagOrExit() {
  if (hasFlag('yes')) return;
  console.error(
    'Refusing to run without --yes. This script permanently deletes app data from MySQL and S3.\n' +
      'Usage: npm run reset:demo -- --yes',
  );
  process.exit(1);
}

function serializeJson(value) {
  if (value == null || value === '') return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function dbConfig(env) {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  const url = new URL(env.DATABASE_URL);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    ssl: String(env.DB_SSL).toLowerCase() === 'true' ? { rejectUnauthorized: false } : undefined,
  };
}

function s3Config(env) {
  if (!env.AWS_REGION || !env.AWS_S3_BUCKET_NAME) {
    throw new Error('AWS_REGION or AWS_S3_BUCKET_NAME is not set');
  }
  const credentials =
    env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
      : undefined;
  return {
    bucket: env.AWS_S3_BUCKET_NAME,
    client: new S3Client({ region: env.AWS_REGION, credentials }),
  };
}

async function deleteBatch(s3, bucket, objects) {
  if (!objects.length) return 0;
  const out = await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }));
  if (out.Errors?.length) {
    throw new Error(`S3 delete failed for ${out.Errors.length} object(s); first key: ${out.Errors[0].Key || 'unknown'}`);
  }
  return objects.length;
}

// Versioned buckets need their individual versions/delete markers removed before
// they are truly empty. Unversioned buckets typically yield no rows here.
async function clearVersionEntries(s3, bucket) {
  let deleted = 0;
  let keyMarker;
  let versionIdMarker;
  while (true) {
    const out = await s3.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        KeyMarker: keyMarker,
        VersionIdMarker: versionIdMarker,
        MaxKeys: 1000,
      }),
    );
    const objects = [
      ...(out.Versions || []).map((item) => ({ Key: item.Key, VersionId: item.VersionId })),
      ...(out.DeleteMarkers || []).map((item) => ({ Key: item.Key, VersionId: item.VersionId })),
    ];
    deleted += await deleteBatch(s3, bucket, objects);
    if (!out.IsTruncated) break;
    keyMarker = out.NextKeyMarker;
    versionIdMarker = out.NextVersionIdMarker;
  }
  return deleted;
}

async function clearCurrentObjects(s3, bucket) {
  let deleted = 0;
  let continuationToken;
  while (true) {
    const out = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      }),
    );
    const objects = (out.Contents || []).map((item) => ({ Key: item.Key }));
    deleted += await deleteBatch(s3, bucket, objects);
    if (!out.IsTruncated) break;
    continuationToken = out.NextContinuationToken;
  }
  return deleted;
}

async function resetDatabase(env, demoEmail) {
  const conn = await mysql.createConnection(dbConfig(env));
  try {
    const [existing] = await conn.execute(
      'SELECT name, email, password_hash, module_access FROM users WHERE email = ? ORDER BY id ASC LIMIT 1',
      [demoEmail],
    );
    const currentDemo = existing[0] || null;
    const demoUser = {
      name: currentDemo?.name || DEMO_DEFAULTS.name,
      email: currentDemo?.email || demoEmail || DEMO_DEFAULTS.email,
      passwordHash: currentDemo?.password_hash || DEMO_DEFAULTS.passwordHash,
      moduleAccess: serializeJson(currentDemo?.module_access),
    };

    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const table of TABLES_TO_TRUNCATE) {
        await conn.query(`TRUNCATE TABLE ${table}`);
      }
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }

    const [insert] = await conn.execute(
      `INSERT INTO users (name, email, password_hash, role, module_access, is_active, deleted_at)
       VALUES (?, ?, ?, ?, ?, 1, NULL)`,
      [demoUser.name, demoUser.email, demoUser.passwordHash, DEMO_DEFAULTS.role, demoUser.moduleAccess],
    );
    await conn.execute('INSERT INTO posting_settings (user_id, owner_email) VALUES (?, ?)', [insert.insertId, demoUser.email]);

    return { demoEmail: demoUser.email, demoName: demoUser.name, userId: insert.insertId };
  } finally {
    await conn.end();
  }
}

async function clearBucket(env) {
  const { client, bucket } = s3Config(env);
  let deletedVersions = 0;
  try {
    deletedVersions = await clearVersionEntries(client, bucket);
  } catch (err) {
    console.warn(`[reset:demo] S3 version purge skipped: ${err.message}`);
  }
  const deletedObjects = await clearCurrentObjects(client, bucket);
  return { bucket, deletedVersions, deletedObjects };
}

async function main() {
  requireFlagOrExit();

  const dbOnly = hasFlag('db-only');
  const s3Only = hasFlag('s3-only');
  if (dbOnly && s3Only) {
    throw new Error('Use either --db-only or --s3-only, not both');
  }

  const env = loadEnv();
  const demoEmail = flag('demo-email') || env.DEMO_EMAIL || DEMO_DEFAULTS.email;
  const shouldResetDb = !s3Only;
  const shouldClearS3 = !dbOnly;

  if (shouldResetDb) dbConfig(env);
  if (shouldClearS3) s3Config(env);

  const summary = {};

  if (shouldResetDb) {
    summary.database = await resetDatabase(env, demoEmail);
  }
  if (shouldClearS3) {
    summary.s3 = await clearBucket(env);
  }

  if (summary.database) {
    console.log(
      `[reset:demo] database reset complete. Preserved demo login "${summary.database.demoEmail}" as user ${summary.database.userId}.`,
    );
  }
  if (summary.s3) {
    console.log(
      `[reset:demo] S3 bucket "${summary.s3.bucket}" cleared. Deleted ${summary.s3.deletedObjects} current object(s)` +
        ` and ${summary.s3.deletedVersions} version/delete-marker entr${summary.s3.deletedVersions === 1 ? 'y' : 'ies'}.`,
    );
  }
  console.log('[reset:demo] done.');
}

main().catch((err) => {
  console.error('[reset:demo] failed:', err.message);
  process.exit(1);
});
