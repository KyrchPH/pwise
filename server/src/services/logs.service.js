import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';

// Shared pool → posting logs are global (every signed-in user sees all of them).
export async function list({ limit = 50, offset = 0 } = {}) {
  return query(
    'SELECT * FROM posting_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [Number(limit) || 50, Number(offset) || 0],
  );
}

export async function getById(userId, id) {
  const rows = await query('SELECT * FROM posting_logs WHERE id = ? AND user_id = ?', [id, userId]);
  if (!rows.length) throw ApiError.notFound('log not found');
  return rows[0];
}

export async function create({
  userId,
  postId = null,
  targetPlatform = null,
  status,
  responseMessage = null,
  errorMessage = null,
  postedAt = null,
}) {
  const result = await query(
    `INSERT INTO posting_logs (user_id, post_id, target_platform, status, response_message, error_message, posted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, postId, targetPlatform, status, responseMessage, errorMessage, postedAt],
  );
  return result.insertId;
}
