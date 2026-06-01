import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';

const ALLOWED_STATUS = ['draft', 'ready', 'posting', 'posted', 'failed', 'archived'];
const ALLOWED_MEDIA = ['image', 'video'];

export async function list(userId, { status, limit = 50, offset = 0 } = {}) {
  const params = [userId];
  let sql = 'SELECT * FROM post_pool WHERE user_id = ?';
  if (status) {
    if (!ALLOWED_STATUS.includes(status)) throw ApiError.badRequest(`invalid status filter: ${status}`);
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit) || 50, Number(offset) || 0);
  return query(sql, params);
}

export async function getById(userId, id) {
  const rows = await query('SELECT * FROM post_pool WHERE id = ? AND user_id = ?', [id, userId]);
  if (!rows.length) throw ApiError.notFound('post not found');
  return rows[0];
}

export async function create(userId, data = {}) {
  const {
    caption = null,
    media_type = null,
    media_url = null,
    s3_key = null,
    target_platform = null,
    status = 'draft',
    priority = 0,
  } = data;
  if (status && !ALLOWED_STATUS.includes(status)) throw ApiError.badRequest(`invalid status: ${status}`);
  if (media_type && !ALLOWED_MEDIA.includes(media_type)) throw ApiError.badRequest(`invalid media_type: ${media_type}`);

  const result = await query(
    `INSERT INTO post_pool (user_id, caption, media_type, media_url, s3_key, target_platform, status, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, caption, media_type, media_url, s3_key, target_platform, status, Number(priority) || 0],
  );
  return getById(userId, result.insertId);
}

export async function update(userId, id, data = {}) {
  await getById(userId, id); // ownership + existence check

  const editable = ['caption', 'media_type', 'media_url', 's3_key', 'target_platform', 'status', 'priority', 'scheduled_at'];
  const fields = [];
  const params = [];
  for (const key of editable) {
    if (!(key in data)) continue;
    if (key === 'status' && data.status && !ALLOWED_STATUS.includes(data.status)) {
      throw ApiError.badRequest(`invalid status: ${data.status}`);
    }
    if (key === 'media_type' && data.media_type && !ALLOWED_MEDIA.includes(data.media_type)) {
      throw ApiError.badRequest(`invalid media_type: ${data.media_type}`);
    }
    fields.push(`${key} = ?`);
    params.push(data[key]);
  }
  if (fields.length) {
    params.push(id, userId);
    await query(`UPDATE post_pool SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, params);
  }
  return getById(userId, id);
}

export async function remove(userId, id) {
  await getById(userId, id);
  await query('DELETE FROM post_pool WHERE id = ? AND user_id = ?', [id, userId]);
  return { id: Number(id), deleted: true };
}

// Status breakdown for the dashboard.
export async function counts(userId) {
  const rows = await query(
    'SELECT status, COUNT(*) AS count FROM post_pool WHERE user_id = ? GROUP BY status',
    [userId],
  );
  const out = { draft: 0, ready: 0, posting: 0, posted: 0, failed: 0, archived: 0, total: 0 };
  for (const r of rows) {
    out[r.status] = Number(r.count);
    out.total += Number(r.count);
  }
  return out;
}
