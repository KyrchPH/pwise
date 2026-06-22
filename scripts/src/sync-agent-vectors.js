// Sync the MySQL source-of-truth tables (`products`, `ai_agent_reference`) into
// the Supabase pgvector store `public.agent_documents`, embedding with OpenAI.
//
// It is INCREMENTAL and idempotent: each source row is hashed, and only rows
// that are new or whose content changed are (re-)embedded. Rows whose content
// is unchanged but whose other columns changed get a cheap metadata-only update
// (no embedding spent). Rows deleted from MySQL are removed from Supabase too.
//
//   cd scripts
//   npm run vectors:sync                  # full sync
//   npm run vectors:sync -- --dry-run     # report changes, no OpenAI calls, no writes
//   npm run vectors:sync -- --source=products
//   npm run vectors:sync -- --no-delete   # never delete from Supabase
//
// Requires (in repo-root .env or server/.env):
//   DATABASE_URL=mysql://...              # MySQL source (same var the app uses)
//   SUPABASE_CONNECTION_STRING=postgres://...   # Supabase target (pooler host)
//   OPENAI_API_KEY=sk-...
//   OPENAI_EMBEDDING_MODEL=text-embedding-3-small   # optional override

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { Client } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

// Same precedence as import-wise-assistant-context.js: repo-root .env, then
// server/.env without overriding anything already set.
dotenv.config({ path: resolve(repoRoot, '.env') });
dotenv.config({ path: resolve(repoRoot, 'server/.env'), override: false });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SCHEMA = 'public';
const TABLE = 'agent_documents';
const TABLE_REF = `"${SCHEMA}"."${TABLE}"`;
const SCHEMA_SQL_PATH = resolve(repoRoot, 'scripts/database/supabase/agent_vectors.sql');

const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const EMBEDDING_DIM = 1536; // text-embedding-3-small. Change with the model AND the SQL DDL.
const MAX_BATCH_ITEMS = 96; // inputs per OpenAI embeddings request
const MAX_BATCH_CHARS = 200_000; // ~50k tokens/request, safely under the API cap
const MAX_CONTENT_CHARS = 18_000; // per-row safety cap (well under the 8192-token input limit)

// Per-source mapping. `contentColumns: null` => embed every column except the
// primary key and the columns in `excludeFromContent`. Set an explicit array to
// control exactly which columns form the embedded text (the FULL row is always
// stored in `metadata` regardless).
// Only the FAQs are embedded — products stay in MySQL (searched via the
// `search_catalog` FULLTEXT tool). The embedded text is just the question + answer;
// account_id rides in `metadata` (NOT the embedded text) so the n8n Supabase Vector
// Store node can filter retrieval to the conversation's page (per-page FAQs).
const SOURCES = [
  {
    source: 'ai_agent_reference',
    mysqlTable: 'ai_agent_reference',
    primaryKey: 'id',
    contentColumns: ['question', 'answer'],
    excludeFromContent: ['created_at', 'updated_at', 'deleted_at', 'account_id'],
  },
];

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const NO_DELETE = argv.includes('--no-delete');
const ALLOW_EMPTY = argv.includes('--allow-empty');
const ONLY_SOURCE = argv.find((a) => a.startsWith('--source='))?.split('=')[1] || null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const prettyLabel = (column) => column.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function cellToText(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function jsonSafe(value) {
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  return value;
}

function buildContent(row, contentColumns) {
  const lines = [];
  for (const col of contentColumns) {
    const text = cellToText(row[col]).trim();
    if (text) lines.push(`${prettyLabel(col)}: ${text}`);
  }
  const content = lines.join('\n');
  return content.length > MAX_CONTENT_CHARS ? content.slice(0, MAX_CONTENT_CHARS) : content;
}

function buildMetadata(row, source, sourceId) {
  const metadata = { source, source_id: sourceId };
  for (const [key, value] of Object.entries(row)) metadata[key] = jsonSafe(value);
  return metadata;
}

const embeddingToVector = (arr) => `[${arr.join(',')}]`;

function resolveContentColumns(cfg, sampleRow) {
  if (cfg.contentColumns?.length) return cfg.contentColumns;
  const exclude = new Set([cfg.primaryKey, ...(cfg.excludeFromContent || [])]);
  return Object.keys(sampleRow).filter((col) => !exclude.has(col));
}

// Group rows into embedding requests bounded by both item count and total chars.
function chunkForEmbedding(items) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const item of items) {
    const len = item.content.length || 1;
    if (current.length && (current.length >= MAX_BATCH_ITEMS || chars + len > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(item);
    chars += len;
  }
  if (current.length) batches.push(current);
  return batches;
}

// ---------------------------------------------------------------------------
// OpenAI embeddings
// ---------------------------------------------------------------------------

async function embedBatch(inputs) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set.');

  for (let attempt = 1; ; attempt += 1) {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
    });

    if (res.ok) {
      const json = await res.json();
      const vectors = json.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((d) => d.embedding);
      if (vectors[0] && vectors[0].length !== EMBEDDING_DIM) {
        throw new Error(
          `Model ${EMBEDDING_MODEL} returned ${vectors[0].length}-dim vectors but the table is vector(${EMBEDDING_DIM}). ` +
            'Align EMBEDDING_DIM + the SQL DDL with the model.',
        );
      }
      return vectors;
    }

    const retryable = res.status === 429 || res.status >= 500;
    const body = await res.text().catch(() => '');
    if (!retryable || attempt >= 5) {
      throw new Error(`OpenAI embeddings failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const waitMs = Math.min(30_000, 500 * 2 ** (attempt - 1));
    console.warn(`  · OpenAI ${res.status} — retrying in ${waitMs}ms (attempt ${attempt}/5)`);
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

function buildMysqlPool() {
  const url = new URL(process.env.DATABASE_URL);
  const useSsl = String(process.env.DB_SSL).toLowerCase() === 'true';
  return mysql.createPool({
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    charset: 'utf8mb4',
    waitForConnections: true,
    connectionLimit: 5,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  });
}

// Mirrors buildConnectionString() in import-wise-assistant-context.js.
function buildSupabaseConnectionString() {
  const explicit =
    process.env.SUPABASE_CONNECTION_STRING ||
    process.env.CONNECTION_STRING ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_CONNECTION_STRING;
  const suppliedPassword = process.env.SUPABASE_DB_PASSWORD || process.env.DB_PASSWORD;

  if (explicit) {
    if (explicit.includes('[YOUR-PASSWORD]')) {
      if (!suppliedPassword) {
        throw new Error(
          'Supabase connection string still contains [YOUR-PASSWORD]. Set SUPABASE_DB_PASSWORD or a full SUPABASE_CONNECTION_STRING.',
        );
      }
      return explicit.replace('[YOUR-PASSWORD]', encodeURIComponent(suppliedPassword));
    }
    return explicit;
  }

  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT || '6543';
  const database = process.env.DATABASE || process.env.PGDATABASE || 'postgres';
  const user = process.env.DB_USER || process.env.PGUSER;
  if (!host || !user || !suppliedPassword) {
    throw new Error(
      'Missing Supabase Postgres credentials. Set SUPABASE_CONNECTION_STRING, or DB_HOST/DB_PORT/DATABASE/DB_USER + SUPABASE_DB_PASSWORD.',
    );
  }
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(suppliedPassword)}@${host}:${port}/${database}`;
}

function buildSupabaseClient() {
  const connectionString = buildSupabaseConnectionString();
  const useSsl =
    !process.env.SUPABASE_DISABLE_SSL &&
    !/localhost|127\.0\.0\.1/i.test(connectionString) &&
    !/sslmode=disable/i.test(connectionString);
  return new Client({ connectionString, ssl: useSsl ? { rejectUnauthorized: false } : undefined });
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

async function ensureSchema(pg) {
  const sql = await readFile(SCHEMA_SQL_PATH, 'utf8');
  try {
    await pg.query(sql);
  } catch (error) {
    throw new Error(
      `Could not apply the vector schema (${error.message}).\n` +
        `Run it once manually in the Supabase SQL editor:\n  ${SCHEMA_SQL_PATH}`,
    );
  }
}

async function loadExisting(pg, source) {
  try {
    const { rows } = await pg.query(
      `SELECT source_id, content_hash, meta_hash FROM ${TABLE_REF} WHERE source = $1`,
      [source],
    );
    return new Map(rows.map((r) => [r.source_id, r]));
  } catch (error) {
    if (error.code === '42P01') {
      // undefined_table — only reachable in --dry-run (which skips ensureSchema).
      console.warn(`  ! ${TABLE} does not exist yet — run without --dry-run to create it.`);
      return new Map();
    }
    throw error;
  }
}

async function syncSource(mysqlPool, pg, cfg) {
  console.log(`\n▶ ${cfg.source}  (MySQL \`${cfg.mysqlTable}\`)`);
  const [rows] = await mysqlPool.query(`SELECT * FROM \`${cfg.mysqlTable}\``);
  console.log(`  · ${rows.length} source rows`);

  if (rows.length === 0 && !ALLOW_EMPTY) {
    console.warn('  ! source returned 0 rows — skipping to avoid mass-deleting the store (use --allow-empty to override).');
    return { source: cfg.source, skipped: true };
  }

  const existing = await loadExisting(pg, cfg.source);
  const contentColumns = rows.length ? resolveContentColumns(cfg, rows[0]) : [];

  const currentIds = new Set();
  const toEmbed = []; // { sourceId, content, metadata, contentHash, metaHash, embedding? }
  const metaOnly = []; // { sourceId, metadata, metaHash }
  let unchanged = 0;

  for (const row of rows) {
    const sourceId = cellToText(row[cfg.primaryKey]);
    if (!sourceId) {
      console.warn(`  ! row with empty primary key (${cfg.primaryKey}) skipped`);
      continue;
    }
    currentIds.add(sourceId);

    const content = buildContent(row, contentColumns);
    const metadata = buildMetadata(row, cfg.source, sourceId);
    const contentHash = sha256(content);
    const metaHash = sha256(JSON.stringify(metadata));

    const prev = existing.get(sourceId);
    if (!prev || prev.content_hash !== contentHash) {
      toEmbed.push({ sourceId, content, metadata, contentHash, metaHash });
    } else if (prev.meta_hash !== metaHash) {
      metaOnly.push({ sourceId, metadata, metaHash });
    } else {
      unchanged += 1;
    }
  }

  const toDelete = NO_DELETE ? [] : [...existing.keys()].filter((id) => !currentIds.has(id));

  console.log(
    `  · new/changed: ${toEmbed.length}  ·  metadata-only: ${metaOnly.length}  ·  unchanged: ${unchanged}  ·  to delete: ${toDelete.length}`,
  );

  if (DRY_RUN) {
    console.log('  · dry run — no embeddings, no writes');
    return { source: cfg.source, embedded: toEmbed.length, metaOnly: metaOnly.length, unchanged, deleted: toDelete.length, dryRun: true };
  }

  // 1) Embed new/changed content (batched, outside the DB transaction).
  if (toEmbed.length) {
    const batches = chunkForEmbedding(toEmbed);
    let done = 0;
    for (const batch of batches) {
      const vectors = await embedBatch(batch.map((item) => item.content));
      batch.forEach((item, i) => {
        item.embedding = vectors[i];
      });
      done += batch.length;
      console.log(`  · embedded ${done}/${toEmbed.length}`);
    }
  }

  // 2) Apply all writes for this source in one transaction.
  await pg.query('BEGIN');
  try {
    for (const item of toEmbed) {
      await pg.query(
        `INSERT INTO ${TABLE_REF}
           (source, source_id, content, metadata, embedding, content_hash, meta_hash, updated_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::vector, $6, $7, now())
         ON CONFLICT (source, source_id) DO UPDATE SET
           content = EXCLUDED.content,
           metadata = EXCLUDED.metadata,
           embedding = EXCLUDED.embedding,
           content_hash = EXCLUDED.content_hash,
           meta_hash = EXCLUDED.meta_hash,
           updated_at = now()`,
        [
          cfg.source,
          item.sourceId,
          item.content,
          JSON.stringify(item.metadata),
          embeddingToVector(item.embedding),
          item.contentHash,
          item.metaHash,
        ],
      );
    }

    for (const item of metaOnly) {
      await pg.query(
        `UPDATE ${TABLE_REF} SET metadata = $3::jsonb, meta_hash = $4, updated_at = now()
         WHERE source = $1 AND source_id = $2`,
        [cfg.source, item.sourceId, JSON.stringify(item.metadata), item.metaHash],
      );
    }

    if (toDelete.length) {
      await pg.query(`DELETE FROM ${TABLE_REF} WHERE source = $1 AND source_id = ANY($2::text[])`, [
        cfg.source,
        toDelete,
      ]);
    }

    await pg.query('COMMIT');
  } catch (error) {
    await pg.query('ROLLBACK').catch(() => {});
    throw error;
  }

  return { source: cfg.source, embedded: toEmbed.length, metaOnly: metaOnly.length, unchanged, deleted: toDelete.length };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL (MySQL source) is not set.');
  if (!DRY_RUN && !process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set.');

  const sources = SOURCES.filter((s) => !ONLY_SOURCE || s.source === ONLY_SOURCE);
  if (ONLY_SOURCE && !sources.length) {
    throw new Error(`Unknown --source=${ONLY_SOURCE}. Known: ${SOURCES.map((s) => s.source).join(', ')}`);
  }

  console.log(
    `Vector sync → ${SCHEMA}.${TABLE}  ·  model ${EMBEDDING_MODEL}  ·  sources: ${sources
      .map((s) => s.source)
      .join(', ')}${DRY_RUN ? '  ·  DRY RUN' : ''}`,
  );

  const mysqlPool = buildMysqlPool();
  const pg = buildSupabaseClient();
  await pg.connect();

  try {
    if (!DRY_RUN) await ensureSchema(pg);

    const results = [];
    for (const cfg of sources) results.push(await syncSource(mysqlPool, pg, cfg));

    console.log('\n✓ Sync complete');
    for (const r of results) {
      if (r.skipped) {
        console.log(`  - ${r.source}: skipped (empty source)`);
        continue;
      }
      console.log(
        `  - ${r.source}: embedded ${r.embedded}, metadata-only ${r.metaOnly}, unchanged ${r.unchanged}, deleted ${r.deleted}${
          r.dryRun ? '  (dry run)' : ''
        }`,
      );
    }
  } finally {
    await pg.end().catch(() => {});
    await mysqlPool.end().catch(() => {});
  }
}

main().catch((error) => {
  console.error('[sync-agent-vectors] failed:', error.message);
  process.exit(1);
});
