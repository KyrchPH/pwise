import { query } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { createDownloadUrl } from './s3.service.js';

const ALLOWED_STATUS = ['draft', 'ready', 'posting', 'posted', 'failed', 'archived'];
const ALLOWED_MEDIA = ['image', 'video'];

// Validate an optional schedule datetime. Must be a valid instant on a :00 or
// :30 boundary. Returns a Date (stored UTC) or null. Empty clears the schedule.
function normalizeScheduledAt(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw ApiError.badRequest('invalid scheduled_at datetime');
  if (![0, 30].includes(d.getUTCMinutes()) || d.getUTCSeconds() !== 0) {
    throw ApiError.badRequest('scheduled time must land on a :00 or :30 boundary');
  }
  return d;
}

function truthy(v) {
  return v === '1' || v === 1 || v === true || v === 'true';
}

// Attach a short-lived presigned GET URL so the UI can show a real thumbnail
// of the (private) S3 media. null if there's no media or S3 isn't configured.
async function withMediaPreview(post) {
  if (!post.s3_key) return { ...post, media_preview_url: null };
  try {
    return { ...post, media_preview_url: await createDownloadUrl(post.s3_key) };
  } catch {
    return { ...post, media_preview_url: null };
  }
}

// Single post per scheduled slot (per user). Posts in a terminal state
// (posted/failed/archived) no longer occupy the slot, so it can be reused.
async function assertSlotFree(userId, scheduledDate, excludeId = null) {
  if (!scheduledDate) return;
  let sql = `SELECT id FROM post_pool
             WHERE user_id = ? AND scheduled_at = ? AND status NOT IN ('posted', 'failed', 'archived')`;
  const params = [userId, scheduledDate];
  if (excludeId != null) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }
  const rows = await query(sql, params);
  if (rows.length) throw ApiError.conflict('A post is already scheduled for that date and time');
}

export async function list(userId, { status, scheduled, limit = 50, offset = 0 } = {}) {
  const params = [userId];
  let sql = 'SELECT * FROM post_pool WHERE user_id = ?';
  if (status) {
    if (!ALLOWED_STATUS.includes(status)) throw ApiError.badRequest(`invalid status filter: ${status}`);
    sql += ' AND status = ?';
    params.push(status);
  }
  if (truthy(scheduled)) sql += ' AND scheduled_at IS NOT NULL';
  sql += ' ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit) || 50, Number(offset) || 0);
  const rows = await query(sql, params);
  return Promise.all(rows.map(withMediaPreview));
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
    target_platform = 'facebook',
    status = 'ready',
    priority = 0,
    scheduled_at = null,
  } = data;
  if (!caption || !String(caption).trim()) throw ApiError.badRequest('caption is required');
  if (status && !ALLOWED_STATUS.includes(status)) throw ApiError.badRequest(`invalid status: ${status}`);
  if (media_type && !ALLOWED_MEDIA.includes(media_type)) throw ApiError.badRequest(`invalid media_type: ${media_type}`);
  const schedule = normalizeScheduledAt(scheduled_at);
  await assertSlotFree(userId, schedule);

  const result = await query(
    `INSERT INTO post_pool (user_id, caption, media_type, media_url, s3_key, target_platform, status, priority, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, caption, media_type, media_url, s3_key, target_platform, status, Number(priority) || 0, schedule],
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
    let value = data[key];
    if (key === 'scheduled_at') {
      value = normalizeScheduledAt(data.scheduled_at);
      await assertSlotFree(userId, value, id);
    }
    fields.push(`${key} = ?`);
    params.push(value);
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
