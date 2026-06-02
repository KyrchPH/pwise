import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load the shared root .env before any config module reads process.env.
const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env from the repo root (monorepo dev) AND from alongside server.js
// (flat production deploy). dotenv won't override already-set vars, so first wins.
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '.env') });

const { createApp } = await import('./src/app.js');
const { env, validateEnv } = await import('./src/config/env.js');
const { pingDb } = await import('./src/config/db.js');

validateEnv();
const app = createApp();

app.listen(env.port, async () => {
  console.log(`[server] listening on http://localhost:${env.port}`);
  try {
    await pingDb();
    console.log('[server] MySQL connection OK');
  } catch (err) {
    console.warn(`[server] MySQL not reachable: ${err.message}`);
  }
});
