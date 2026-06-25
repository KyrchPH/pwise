import { query } from '../config/db.js';

// App-wide runtime flags (key/value) — unlike env feature flags, these toggle without
// a restart. Currently the two admin "pause" switches. A missing key = off (false), so
// the app behaves normally until an admin pauses something.

const AI_PAUSED = 'ai_paused';
const POSTING_PAUSED = 'posting_paused';

async function getBool(key) {
  // Guarded: a pre-migration DB (no app_settings table) degrades to "not paused".
  const rows = await query('SELECT value FROM app_settings WHERE setting_key = ?', [key]).catch(() => []);
  return rows.length ? rows[0].value === '1' : false;
}

async function setBool(key, value, userId = null) {
  const v = value ? '1' : '0';
  await query(
    'INSERT INTO app_settings (setting_key, value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?, updated_by = ?',
    [key, v, userId, v, userId],
  );
}

// Read helpers used by the gates (inbound gateway / scheduler).
export function isAiPaused() {
  return getBool(AI_PAUSED);
}

export function isPostingPaused() {
  return getBool(POSTING_PAUSED);
}

export async function getPauseState() {
  const [aiPaused, postingPaused] = await Promise.all([getBool(AI_PAUSED), getBool(POSTING_PAUSED)]);
  return { aiPaused, postingPaused };
}

// Set either/both flags; only the keys actually provided are changed.
export async function setPause({ aiPaused, postingPaused } = {}, userId = null) {
  if (aiPaused !== undefined) await setBool(AI_PAUSED, aiPaused, userId);
  if (postingPaused !== undefined) await setBool(POSTING_PAUSED, postingPaused, userId);
  return getPauseState();
}
