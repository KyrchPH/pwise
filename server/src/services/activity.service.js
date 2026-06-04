import { query } from '../config/db.js';

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

// Most-recent-first audit feed (shared — every signed-in user can see it).
export async function list({ limit = 100, offset = 0 } = {}) {
  return query(
    'SELECT * FROM post_activity_log ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
    [Math.min(Number(limit) || 100, 200), Number(offset) || 0],
  );
}
