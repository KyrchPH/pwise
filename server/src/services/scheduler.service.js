import { query, getConnection } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { isWithinWindow, minutesSince } from '../utils/date.util.js';
import { createDownloadUrl } from './s3.service.js';
import * as logsService from './logs.service.js';

async function enabledUserIds() {
  const rows = await query('SELECT user_id FROM posting_settings WHERE is_enabled = 1');
  return rows.map((r) => Number(r.user_id));
}

// Users due by INTERVAL: enabled, inside the allowed window, interval elapsed
// since the last post, and holding at least one UNSCHEDULED ready post.
// Window math is done in Node (Intl) to avoid relying on DB timezone tables.
async function intervalDueUserIds() {
  const rows = await query(
    `SELECT ps.user_id, ps.posting_interval_minutes, ps.allowed_start_time,
            ps.allowed_end_time, ps.timezone,
            (SELECT MAX(p.posted_at) FROM post_pool p
               WHERE p.user_id = ps.user_id AND p.status = 'posted') AS last_posted_at,
            (SELECT COUNT(*) FROM post_pool p
               WHERE p.user_id = ps.user_id AND p.status = 'ready' AND p.scheduled_at IS NULL) AS ready_count
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

// Atomically claim the single post matching `whereSql`/`orderBy`, mark it
// 'posting', and return it with a presigned media URL. SKIP LOCKED guarantees
// two concurrent runs can't grab the same row.
async function claimAndLock(whereSql, params, orderBy) {
  const conn = await getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM post_pool WHERE ${whereSql} ORDER BY ${orderBy} LIMIT 1 FOR UPDATE SKIP LOCKED`,
      params,
    );
    if (!rows.length) {
      await conn.commit();
      return null;
    }
    const post = rows[0];
    await conn.query("UPDATE post_pool SET status = 'posting' WHERE id = ?", [post.id]);
    await conn.commit();

    let mediaDownloadUrl = null;
    if (post.s3_key) {
      try {
        mediaDownloadUrl = await createDownloadUrl(post.s3_key);
      } catch {
        /* S3 not configured / object missing */
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

/**
 * Claim the next post to publish.
 *   Phase 1 — a DUE scheduled post (scheduled_at <= now), which overrides the
 *             allowed-window and interval (the user picked an exact time).
 *   Phase 2 — fallback: an UNSCHEDULED ready post, gated by the posting interval
 *             and allowed window (the original behavior).
 */
export async function claimNext({ userId = null } = {}) {
  const enabled = await enabledUserIds();

  // Phase 1: due scheduled posts, earliest scheduled time first.
  let schedUsers = enabled;
  if (userId != null) schedUsers = enabled.includes(Number(userId)) ? [Number(userId)] : [];
  if (schedUsers.length) {
    const claimed = await claimAndLock(
      "status = 'ready' AND scheduled_at IS NOT NULL AND scheduled_at <= UTC_TIMESTAMP() AND user_id IN (?)",
      [schedUsers],
      'scheduled_at ASC, priority DESC, created_at ASC',
    );
    if (claimed) return { ...claimed, via: 'scheduled' };
  }

  // Phase 2: interval fallback (unscheduled posts only).
  const due = await intervalDueUserIds();
  let intervalUsers = due;
  if (userId != null) intervalUsers = due.includes(Number(userId)) ? [Number(userId)] : [];
  if (!intervalUsers.length) {
    return { claimed: false, reason: 'nothing due (no scheduled post ready, no interval match)' };
  }
  const claimed = await claimAndLock(
    "status = 'ready' AND scheduled_at IS NULL AND user_id IN (?)",
    [intervalUsers],
    'priority DESC, created_at ASC',
  );
  return claimed ? { ...claimed, via: 'interval' } : { claimed: false, reason: 'no ready posts available' };
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
