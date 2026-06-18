import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';

const PAGE_SIZE = 10;

function pageParams({ limit = PAGE_SIZE, offset = 0 } = {}) {
  const rawLimit = Math.trunc(Number(limit) || PAGE_SIZE);
  const rawOffset = Math.trunc(Number(offset) || 0);
  return {
    limit: Math.min(Math.max(rawLimit, 1), PAGE_SIZE),
    offset: Math.max(rawOffset, 0),
  };
}

// Shared pool: posting logs are global, so every signed-in user sees all of them.
export async function list({ limit = PAGE_SIZE, offset = 0 } = {}) {
  const page = pageParams({ limit, offset });
  const logs = await query(
    'SELECT * FROM posting_logs ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [page.limit, page.offset],
  );
  const countRows = await query('SELECT COUNT(*) AS total FROM posting_logs');
  return {
    logs,
    total: Number(countRows[0]?.total) || 0,
    limit: page.limit,
    offset: page.offset,
  };
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
