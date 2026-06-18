import { query } from '../config/db.js';

const PAGE_SIZE = 10;

function pageParams({ limit = PAGE_SIZE, offset = 0 } = {}) {
  const rawLimit = Math.trunc(Number(limit) || PAGE_SIZE);
  const rawOffset = Math.trunc(Number(offset) || 0);
  return {
    limit: Math.min(Math.max(rawLimit, 1), PAGE_SIZE),
    offset: Math.max(rawOffset, 0),
  };
}

// Append an audit entry for a post action. Best-effort: a logging failure must
// never break the underlying create/edit/delete, so errors are swallowed.
export async function log({ postId = null, noteId = null, userId = null, userName = null, action, details = null }) {
  try {
    await query(
      'INSERT INTO post_activity_log (post_id, note_id, user_id, user_name, action, details) VALUES (?, ?, ?, ?, ?, ?)',
      [postId, noteId, userId, userName, action, details],
    );
  } catch (err) {
    console.warn(`[activity] failed to log "${action}": ${err.message}`);
  }
}

// Most-recent-first audit feed, shared across signed-in users.
export async function list({ limit = PAGE_SIZE, offset = 0 } = {}) {
  const page = pageParams({ limit, offset });
  const activity = await query(
    'SELECT * FROM post_activity_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    [page.limit, page.offset],
  );
  const countRows = await query('SELECT COUNT(*) AS total FROM post_activity_log');
  return {
    activity,
    total: Number(countRows[0]?.total) || 0,
    limit: page.limit,
    offset: page.offset,
  };
}
