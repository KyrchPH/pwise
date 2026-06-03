import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Env precedence: server/.env (server-only — e.g. the Meta/Graph token) wins,
// then the shared repo-root .env fills in the rest (DB, JWT, SERVICE_TOKEN, AWS —
// shared with the scripts workspace). dotenv won't override already-set vars, so
// the FIRST file to set a var wins. Both are also read in a flat production deploy.
dotenv.config({ path: resolve(__dirname, '.env') }); // server/.env — server-specific, wins
dotenv.config({ path: resolve(__dirname, '../.env') }); // repo root — shared fallback

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
