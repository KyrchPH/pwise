import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Load the shared root .env regardless of the workspace CWD.
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '../../.env') });

/**
 * Automation worker (Option B from the build plan).
 *
 * Today: a placeholder entry point for the `scripts` workspace.
 * Later: a node-cron schedule that periodically POSTs to
 *   `${SERVER_URL}/api/scheduler/run` with the `x-scheduler-secret` header,
 * driving the server-side posting logic. (n8n is the alternative trigger.)
 */
function main() {
  const serverUrl = process.env.SERVER_URL || 'http://localhost:5000';
  console.log('[scripts] automation worker scaffold ready.');
  console.log(`[scripts] scheduler target: ${serverUrl}/api/scheduler/run`);
  console.log('[scripts] cron trigger is wired up in the automation phase.');
}

main();
