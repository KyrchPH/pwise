import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
// server/.env is the COMPLETE, authoritative server config — everything env.js
// reads. In a flat production deploy it's the ONLY file the server needs (drop it
// next to server.js). The repo-root .env is loaded too as a dev fallback (it
// holds the scripts workspace's vars). dotenv won't override already-set vars, so
// server/.env (loaded first) wins — a flat deploy with no root .env works fine.
dotenv.config({ path: resolve(__dirname, '.env') }); // server/.env — complete + authoritative
dotenv.config({ path: resolve(__dirname, '../.env') }); // repo-root — dev/scripts fallback (optional)

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
