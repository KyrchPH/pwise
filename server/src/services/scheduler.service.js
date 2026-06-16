import { query, getConnection } from '../config/db.js';
import ApiError from '../utils/ApiError.js';
import { minutesSince } from '../utils/date.util.js';
import { createDownloadUrl } from './s3.service.js';
import * as logsService from './logs.service.js';
import * as fb from './fb.service.js';
import * as accounts from './platform_accounts.service.js';

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

    // Hand n8n the target page's id + (decrypted) token so it posts to the right
    // page. Null when the post isn't tagged — n8n falls back to its own creds.
    let page = null;
    if (post.account_id) {
      try {
        const a = await accounts.getDecrypted(post.account_id);
        page = { fb_page_id: a.fb_page_id, access_token: a.access_token };
      } catch {
        /* page gone / encryption unavailable */
      }
    }
    return {
      claimed: true,
      post: { ...post, status: 'posting', media_download_url: mediaDownloadUrl, page },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Batch variant of claimAndLock: atomically claim up to `limit` rows matching
// `whereSql`/`orderBy`, flip them all to 'posting', and return each enriched with
// a presigned media URL + the target page's decrypted creds. SKIP LOCKED still
// guarantees two concurrent runs can't grab the same row. Enrichment runs after
// commit so a slow S3/decrypt call doesn't hold the row locks.
async function claimAndLockBatch(whereSql, params, orderBy, limit) {
  const conn = await getConnection();
  let claimed = [];
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM post_pool WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ? FOR UPDATE SKIP LOCKED`,
      [...params, limit],
    );
    if (!rows.length) {
      await conn.commit();
      return [];
    }
    await conn.query("UPDATE post_pool SET status = 'posting' WHERE id IN (?)", [rows.map((r) => r.id)]);
    await conn.commit();
    claimed = rows;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const out = [];
  for (const post of claimed) {
    let mediaDownloadUrl = null;
    if (post.s3_key) {
      try {
        mediaDownloadUrl = await createDownloadUrl(post.s3_key);
      } catch {
        /* S3 not configured / object missing */
      }
    }
    let page = null;
    if (post.account_id) {
      try {
        const a = await accounts.getDecrypted(post.account_id);
        page = { fb_page_id: a.fb_page_id, access_token: a.access_token };
      } catch {
        /* page gone / encryption unavailable — n8n falls back to its own creds */
      }
    }
    out.push({ ...post, status: 'posting', media_download_url: mediaDownloadUrl, page });
  }
  return out;
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

/**
 * Drain variant of claimNext: claim up to `limit` DUE scheduled posts in one
 * atomic batch (earliest first), each flipped to 'posting' and returned with its
 * own page creds + media URL. Lets n8n publish a whole due slot in a single run
 * (e.g. several pages scheduled at the same time) instead of one post per trigger.
 * Returns { claimed, count, posts }. `limit` is clamped to 1..50.
 */
export async function claimNextBatch({ userId = null, limit = 10 } = {}) {
  await expireOverdue(); // overdue posts are skipped (expired), never posted late
  const enabled = await enabledUserIds();

  let schedUsers = enabled;
  if (userId != null) schedUsers = enabled.includes(Number(userId)) ? [Number(userId)] : [];
  if (!schedUsers.length) {
    return { claimed: false, count: 0, posts: [], reason: 'no enabled users' };
  }

  const lim = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const posts = await claimAndLockBatch(
    "status = 'ready' AND scheduled_at IS NOT NULL AND scheduled_at <= UTC_TIMESTAMP() AND user_id IN (?)",
    [schedUsers],
    'scheduled_at ASC, priority DESC, created_at ASC',
    lim,
  );

  // Trim to exactly what n8n needs (mirrors the single-claim post shape + the
  // immediate webhook payload), so page tokens aren't padded with extra columns.
  return {
    claimed: posts.length > 0,
    count: posts.length,
    via: 'scheduled',
    posts: posts.map((p) => ({
      id: p.id,
      caption: p.caption,
      media_type: p.media_type,
      media_download_url: p.media_download_url,
      target_platform: p.target_platform,
      page: p.page,
    })),
  };
}

export async function markPosted(postId, { platformPostId = null, responseMessage = null, targetPlatform = null } = {}) {
  const rows = await query('SELECT * FROM post_pool WHERE id = ?', [postId]);
  const post = rows[0];
  if (!post) throw ApiError.notFound('post not found');

  // Resolve the {page}_{post} feed id now so shares can be read per-post later.
  // Best-effort: a video's feed story may not be indexed yet (then it's null and
  // the next engagement refresh backfills it). Use the post's page credentials.
  let pageCtx = {};
  if (post.account_id) {
    try {
      const a = await accounts.getDecrypted(post.account_id);
      pageCtx = { token: a.access_token, fbPageId: a.fb_page_id };
    } catch {
      /* fall back to env */
    }
  }
  const parentPostId = await fb.resolveParentPostId(platformPostId, pageCtx);
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

// NOTE: engagement is no longer swept here. The Post Pool page refreshes the
// engagement of the posts it actually displays, on view, in one Graph batch —
// see post_pool.service.refreshEngagement(). That keeps Graph cost proportional
// to what's on screen instead of growing with the whole published history.
