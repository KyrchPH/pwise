import { query, getConnection } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { minutesSince } from '../utils/date.util.js';
import { createDownloadUrl } from './s3.service.js';
import * as logsService from './logs.service.js';
import * as fb from './fb.service.js';

async function enabledUserIds() {
  const rows = await query('SELECT user_id FROM posting_settings WHERE is_enabled = 1');
  return rows.map((r) => Number(r.user_id));
}

// A 'ready' post more than this many minutes past its scheduled time is overdue
// → marked 'expired' and never published (so it can't fire late or jump ahead of
// on-time posts). Must be >= the n8n check interval; n8n checks ~every 5 min, so
// 10 min gives a couple of attempts before giving up. Rescheduling an expired
// post (editing its date/time to a future slot) revives it to 'ready'.
const EXPIRE_AFTER_MINUTES = 10;

// Expire overdue scheduled posts. Runs on every claim (each n8n check), so stale
// posts are cleared even while Auto-posting is off (no enabled users).
async function expireOverdue() {
  await query(
    `UPDATE post_pool SET status = 'expired'
      WHERE status = 'ready' AND scheduled_at IS NOT NULL
        AND scheduled_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
    [EXPIRE_AFTER_MINUTES],
  );
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
 * Claim the next post to publish: a DUE scheduled post (scheduled_at <= now) for
 * an enabled user, earliest scheduled time first. Every post is scheduled to an
 * exact date/time — there is no interval fallback.
 */
export async function claimNext({ userId = null } = {}) {
  await expireOverdue(); // overdue posts are skipped (expired), never posted late
  const enabled = await enabledUserIds();

  let schedUsers = enabled;
  if (userId != null) schedUsers = enabled.includes(Number(userId)) ? [Number(userId)] : [];
  if (!schedUsers.length) {
    return { claimed: false, reason: 'no enabled users' };
  }

  const claimed = await claimAndLock(
    "status = 'ready' AND scheduled_at IS NOT NULL AND scheduled_at <= UTC_TIMESTAMP() AND user_id IN (?)",
    [schedUsers],
    'scheduled_at ASC, priority DESC, created_at ASC',
  );
  return claimed ? { ...claimed, via: 'scheduled' } : { claimed: false, reason: 'no scheduled post due' };
}

export async function markPosted(postId, { platformPostId = null, responseMessage = null, targetPlatform = null } = {}) {
  const rows = await query('SELECT * FROM post_pool WHERE id = ?', [postId]);
  const post = rows[0];
  if (!post) throw ApiError.notFound('post not found');

  // Resolve the {page}_{post} feed id now so shares can be read per-post later.
  // Best-effort: a video's feed story may not be indexed yet (then it's null and
  // pendingEngagement backfills it on the first sync).
  const parentPostId = await fb.resolveParentPostId(platformPostId);
  await query(
    "UPDATE post_pool SET status = 'posted', posted_at = UTC_TIMESTAMP(), platform_post_id = ?, parent_post_id = ? WHERE id = ?",
    [platformPostId, parentPostId, postId],
  );
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

// Published posts (with a platform id) whose engagement the n8n sync flow should
// refresh from the platform. Most-recently-posted first.
export async function pendingEngagement(limit = 50) {
  // The engagement sync runs on its own schedule (≈hourly), independent of the
  // publish poll, so run the expiry sweep here too — overdue posts still get
  // cleared even if the publish workflow is paused/deactivated. Cheap, once per sync.
  await expireOverdue();
  const posts = await query(
    `SELECT id, platform_post_id, parent_post_id, media_type, posted_at
       FROM post_pool
      WHERE status = 'posted' AND platform_post_id IS NOT NULL
      ORDER BY posted_at DESC
      LIMIT ?`,
    [Number(limit) || 50],
  );
  // Backfill any missing parent_post_id (e.g. a video whose feed story wasn't
  // indexed yet at mark-posted time). Resolved once, then cached on the row.
  for (const p of posts) {
    if (!p.parent_post_id && p.platform_post_id) {
      const parent = await fb.resolveParentPostId(p.platform_post_id);
      if (parent) {
        await query('UPDATE post_pool SET parent_post_id = ? WHERE id = ?', [parent, p.id]);
        p.parent_post_id = parent;
      }
    }
  }
  return posts;
}

// Store engagement counts pulled from the platform (called by n8n). Any missing
// metric is stored as NULL.
export async function saveEngagement(postId, { reactions, comments, shares, views } = {}) {
  const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
  const result = await query(
    `UPDATE post_pool
        SET reactions_count = ?, comments_count = ?, shares_count = ?, views_count = ?,
            engagement_synced_at = UTC_TIMESTAMP()
      WHERE id = ?`,
    [num(reactions), num(comments), num(shares), num(views), postId],
  );
  if (!result.affectedRows) throw ApiError.notFound('post not found');
  return (await query('SELECT * FROM post_pool WHERE id = ?', [postId]))[0];
}
