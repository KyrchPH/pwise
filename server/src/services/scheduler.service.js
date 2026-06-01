import { query, getConnection } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { isWithinWindow, minutesSince } from '../utils/date.util.js';
import { createDownloadUrl } from './s3.service.js';
import * as logsService from './logs.service.js';

// Which enabled users are currently DUE: in their posting window, interval
// elapsed since their last post, and they have at least one ready post.
// Window math is done in Node (Intl) to avoid depending on MySQL tz tables.
async function dueUserIds() {
  const rows = await query(
    `SELECT ps.user_id, ps.posting_interval_minutes, ps.allowed_start_time,
            ps.allowed_end_time, ps.timezone,
            (SELECT MAX(p.posted_at) FROM post_pool p
               WHERE p.user_id = ps.user_id AND p.status = 'posted') AS last_posted_at,
            (SELECT COUNT(*) FROM post_pool p
               WHERE p.user_id = ps.user_id AND p.status = 'ready') AS ready_count
     FROM posting_settings ps
     WHERE ps.is_enabled = 1`,
  );
  const now = new Date();
  const due = [];
  for (const r of rows) {
    if (Number(r.ready_count) === 0) continue;
    if (!isWithinWindow(now, r.allowed_start_time, r.allowed_end_time, r.timezone)) continue;
    if (minutesSince(r.last_posted_at) < Number(r.posting_interval_minutes)) continue;
    due.push(Number(r.user_id));
  }
  return due;
}

// Atomically claim the next post to publish: pick the highest-priority ready
// post for a due user, mark it 'posting', and return it with a presigned media
// URL. FOR UPDATE SKIP LOCKED guarantees two concurrent runs can't grab the same row.
export async function claimNext({ userId = null } = {}) {
  const due = await dueUserIds();
  let candidates = due;
  if (userId != null) {
    candidates = due.includes(Number(userId)) ? [Number(userId)] : [];
  }
  if (!candidates.length) return { claimed: false, reason: 'no due users with ready posts' };

  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const placeholders = candidates.map(() => '?').join(', ');
    const [rows] = await conn.query(
      `SELECT * FROM post_pool
         WHERE status = 'ready' AND user_id IN (${placeholders})
         ORDER BY priority DESC, created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
      candidates,
    );
    if (!rows.length) {
      await conn.commit();
      return { claimed: false, reason: 'no ready posts available' };
    }
    const post = rows[0];
    await conn.query("UPDATE post_pool SET status = 'posting' WHERE id = ?", [post.id]);
    await conn.commit();

    let mediaDownloadUrl = null;
    if (post.s3_key) {
      try {
        mediaDownloadUrl = await createDownloadUrl(post.s3_key);
      } catch {
        // S3 not configured / object missing — leave null, n8n can decide.
      }
    }
    return { claimed: true, post: { ...post, status: 'posting', media_download_url: mediaDownloadUrl } };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

export async function markPosted(postId, { platformPostId = null, responseMessage = null, targetPlatform = null } = {}) {
  const rows = await query('SELECT * FROM post_pool WHERE id = ?', [postId]);
  const post = rows[0];
  if (!post) throw ApiError.notFound('post not found');

  await query("UPDATE post_pool SET status = 'posted', posted_at = UTC_TIMESTAMP() WHERE id = ?", [postId]);
  const updated = (await query('SELECT * FROM post_pool WHERE id = ?', [postId]))[0];

  await logsService.create({
    userId: post.user_id,
    postId,
    targetPlatform: targetPlatform || post.target_platform,
    status: 'posted',
    responseMessage: responseMessage || (platformPostId ? `platform_post_id=${platformPostId}` : 'posted'),
    postedAt: updated.posted_at,
  });
  return updated;
}

export async function markFailed(postId, { errorMessage = null } = {}) {
  const rows = await query('SELECT * FROM post_pool WHERE id = ?', [postId]);
  const post = rows[0];
  if (!post) throw ApiError.notFound('post not found');

  await query("UPDATE post_pool SET status = 'failed', failed_reason = ? WHERE id = ?", [errorMessage, postId]);
  const updated = (await query('SELECT * FROM post_pool WHERE id = ?', [postId]))[0];

  await logsService.create({
    userId: post.user_id,
    postId,
    targetPlatform: post.target_platform,
    status: 'failed',
    errorMessage: errorMessage || 'unknown error',
  });
  return updated;
}

// Per-user ready counts + whether a low-pool alert should fire (24h cooldown).
// n8n calls this and sends the email; markAlertSent records the cooldown stamp.
export async function poolStatus() {
  const rows = await query(
    `SELECT ps.user_id, ps.owner_email, ps.low_pool_alert_threshold, ps.last_alert_sent_at,
            (SELECT COUNT(*) FROM post_pool p
               WHERE p.user_id = ps.user_id AND p.status = 'ready') AS ready_count
     FROM posting_settings ps
     WHERE ps.is_enabled = 1`,
  );
  return rows.map((r) => {
    const ready = Number(r.ready_count);
    const low = ready <= Number(r.low_pool_alert_threshold);
    const cooldownPassed = minutesSince(r.last_alert_sent_at) >= 24 * 60;
    return {
      user_id: r.user_id,
      owner_email: r.owner_email,
      ready_count: ready,
      threshold: Number(r.low_pool_alert_threshold),
      low,
      should_alert: low && cooldownPassed,
      last_alert_sent_at: r.last_alert_sent_at,
    };
  });
}

export async function markAlertSent(userId) {
  const result = await query(
    'UPDATE posting_settings SET last_alert_sent_at = UTC_TIMESTAMP() WHERE user_id = ?',
    [userId],
  );
  if (!result.affectedRows) throw ApiError.notFound('settings not found for user');
  return { user_id: Number(userId), alert_sent_at: new Date().toISOString() };
}
