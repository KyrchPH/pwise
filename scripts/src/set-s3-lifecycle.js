// One-off: install/refresh the S3 lifecycle rule that auto-expires TEMPORARY
// uploads — the `tmp/` prefix used by "Generate with Template" input clips. Any
// temp object not deleted explicitly (e.g. the user picked "Upload output"
// instead of "Drop & close") is removed by S3 after the configured number of days.
//
//   Run from the repo root (Node 18+):  npm run s3:lifecycle
//
// Reads AWS_REGION / AWS_S3_BUCKET_NAME / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
// from .env (root) or server/.env — the same config the server's S3 client uses.
// Optional overrides: TMP_PREFIX (default "tmp/"), TMP_LIFECYCLE_DAYS (default 1).
//
// Idempotent and safe: it preserves any existing lifecycle rules and only
// (re)writes the one with ID `expire-pwise-tmp`.
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  S3Client,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Mirror scripts/src/probe-insights.js: read .env (root) then server/.env,
// without overriding anything already in the real environment.
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
const REGION = env.AWS_REGION;
const BUCKET = env.AWS_S3_BUCKET_NAME;
const PREFIX = env.TMP_PREFIX || 'tmp/';
const DAYS = Number(env.TMP_LIFECYCLE_DAYS) || 1; // S3 minimum granularity is 1 day
const RULE_ID = 'expire-pwise-tmp';

if (!REGION || !BUCKET) {
  console.error('Missing AWS_REGION or AWS_S3_BUCKET_NAME (.env or server/.env).');
  process.exit(1);
}

// Same credential strategy as server/src/config/s3.js: explicit keys if present,
// otherwise the default AWS provider chain (e.g. an EC2 IAM role).
const credentials =
  env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
    ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
    : undefined;

const s3 = new S3Client({ region: REGION, credentials });

async function existingRules() {
  try {
    const out = await s3.send(new GetBucketLifecycleConfigurationCommand({ Bucket: BUCKET }));
    return out.Rules || [];
  } catch (err) {
    if (err?.name === 'NoSuchLifecycleConfiguration') return []; // bucket has no rules yet
    throw err;
  }
}

async function main() {
  const rules = await existingRules();
  const others = rules.filter((r) => r.ID !== RULE_ID); // keep everyone else's rules
  const ours = {
    ID: RULE_ID,
    Filter: { Prefix: PREFIX },
    Status: 'Enabled',
    Expiration: { Days: DAYS },
  };

  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: BUCKET,
      LifecycleConfiguration: { Rules: [...others, ours] },
    }),
  );

  console.log(`✅ Lifecycle rule "${RULE_ID}" set on ${BUCKET}: expire "${PREFIX}" objects after ${DAYS} day(s).`);
  if (others.length) {
    console.log(`   Preserved ${others.length} existing rule(s): ${others.map((r) => r.ID || '(unnamed)').join(', ')}`);
  }
}

main().catch((e) => {
  console.error('Failed to set lifecycle rule:', e.message);
  process.exit(1);
});
