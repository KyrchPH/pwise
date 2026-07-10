import { query } from '../config/db.js';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import { createDownloadUrl, deleteObject } from './s3.service.js';
import * as fb from './fb.service.js';
import * as activity from './activity.service.js';
import * as accounts from './platform_accounts.service.js';
import * as messaging from './messaging.service.js';
import { getSelectedAccountId } from './settings.service.js';

// Decrypted page credentials for a post's connected page. Returns {} when the
// post isn't tagged with a page yet — fb.service then falls back to the env token.
async function pageCtx(post) {
  if (!post?.account_id) return {};
  try {
    const a = await accounts.getDecrypted(post.account_id);
    return { token: a.access_token, fbPageId: a.fb_page_id };
  } catch {
    return {};
  }
}

const ALLOWED_STATUS = ['draft', 'ready', 'posting', 'posted', 'failed', 'archived', 'expired', 'deleted'];
const ALLOWED_MEDIA = ['image', 'video'];
// How a post is published: 'post' (text/photo → /feed or /photos), 'video' (feed
// video → /videos), 'reel' (→ /video_reels). Orthogonal to media_type; immutable
// after creation (it picks the publish path).
const ALLOWED_KINDS = ['post', 'video', 'reel'];

// Engagement counts older than this are re-read from Facebook when a post is
// viewed; within the window the cached numbers are served, so rapid reloads (or
// the background revalidate) don't re-hit Graph.
const ENGAGEMENT_TTL_MS = 5 * 60 * 1000;

// Insight metric → the snapshot/post column it maps to (whitelist; the value is
// interpolated into SQL, so it MUST only ever come from here).
const INSIGHT_METRICS = {
  reactions: 'reactions_count',
  comments: 'comments_count',
  shares: 'shares_count',
  views: 'views_count',
};

function engagementStale(syncedAt) {
  if (!syncedAt) return true;
  const t = new Date(syncedAt).getTime();
  return Number.isNaN(t) || Date.now() - t >= ENGAGEMENT_TTL_MS;
}

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

// Attach short-lived presigned GET URLs so the UI can show the (private) S3
// media. `media_preview_url` is the full file; `thumbnail_preview_url` is the
// optimized still generated at upload (a video's first frame / a downscaled
// image) — used wherever a lightweight preview is enough. Either is null when
// absent or S3 isn't configured.
export async function withMediaPreview(post) {
  const out = { ...post, media_preview_url: null, thumbnail_preview_url: null };
  if (post.s3_key) {
    try {
      out.media_preview_url = await createDownloadUrl(post.s3_key);
    } catch {
      /* S3 not configured / object missing */
    }
  }
  if (post.thumbnail_s3_key) {
    try {
      out.thumbnail_preview_url = await createDownloadUrl(post.thumbnail_s3_key);
    } catch {
      /* S3 not configured / object missing */
    }
  }
  return out;
}

// One post per scheduled slot — GLOBAL now (the pool is shared and everything
// posts to one Facebook page). Posts in a terminal state (posted/failed/
// archived) no longer occupy the slot, so it can be reused.
async function assertSlotFree(scheduledDate, excludeId = null) {
  if (!scheduledDate) return;
  let sql = `SELECT id FROM post_pool
             WHERE scheduled_at = ? AND status NOT IN ('posted', 'failed', 'archived', 'expired', 'deleted')`;
  const params = [scheduledDate];
  if (excludeId != null) {
    sql += ' AND id <> ?';
    params.push(excludeId);
  }
  const rows = await query(sql, params);
  if (rows.length) throw ApiError.conflict('A post is already scheduled for that date and time');
}

// Non-throwing slot check for the client to pre-flight BEFORE uploading media,
// so a post bound to an already-taken slot doesn't orphan a file in S3.
export async function isSlotFree(scheduledAt, excludeId = null) {
  const schedule = normalizeScheduledAt(scheduledAt); // validates :00/:30 boundary
  if (!schedule) return true;
  let sql = `SELECT id FROM post_pool
             WHERE scheduled_at = ? AND status NOT IN ('posted', 'failed', 'archived', 'expired', 'deleted')`;
  const params = [schedule];
  if (excludeId != null) {
    sql += ' AND id <> ?';
    params.push(Number(excludeId));
  }
  const rows = await query(sql, params);
  return rows.length === 0;
}

// Shared pool: every user sees every post. A row's `user_id` records its creator
// (for the audit trail), not access control.
// An ISO timestamp → a naive UTC 'YYYY-MM-DD HH:MM:SS' literal. Both sides of the
// posted_at comparison are then UTC, so there's no connection-timezone skew.
function toUtcDatetime(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
}

export async function list({ status, scheduled, accountId = null, allPages = false, from = null, to = null, limit = 50, offset = 0 } = {}) {
  const crossPage = truthy(allPages);
  // Page-scoped view: every post belongs to a connected page, so with no active
  // page selected there is nothing in scope. (A null account used to mean "no
  // filter" → a fresh deploy with no connected page still listed every post.)
  // The Content Calendar is now GENERAL, so it opts into `allPages` to see every
  // page's posts at once (each row tagged with its page name / fb id for the logo).
  if (!crossPage && accountId == null) return { posts: [], total: 0 };

  const where = [];
  const params = [];
  if (!crossPage) {
    where.push('p.account_id = ?');
    params.push(accountId);
  }
  if (status) {
    if (!ALLOWED_STATUS.includes(status)) throw ApiError.badRequest(`invalid status filter: ${status}`);
    where.push('p.status = ?');
    params.push(status);
  }
  if (truthy(scheduled)) where.push('p.scheduled_at IS NOT NULL');
  // Posted-date range. Filtering on posted_at implicitly drops unpublished posts
  // (NULL posted_at fails the comparison) — intended: a date range shows what went out.
  const fromUtc = toUtcDatetime(from);
  const toUtc = toUtcDatetime(to);
  if (fromUtc) {
    where.push('p.posted_at >= ?');
    params.push(fromUtc);
  }
  if (toUtc) {
    where.push('p.posted_at <= ?');
    params.push(toUtc);
  }
  const whereSql = where.length ? ' WHERE ' + where.join(' AND ') : '';
  // Cross-page rows carry the owning page's name + fb id so the calendar can draw
  // each post's page logo; the page-scoped path is unchanged (SELECT p.*).
  const joinSql = crossPage ? ' LEFT JOIN platform_accounts a ON a.id = p.account_id' : '';
  const selectCols = crossPage ? 'p.*, a.account_name AS page_name, a.fb_page_id AS page_fb_id' : 'p.*';

  // Total for the same filter, so the client can paginate (page X of Y).
  const [{ total }] = await query(`SELECT COUNT(*) AS total FROM post_pool p${whereSql}`, params);

  const rows = await query(
    `SELECT ${selectCols} FROM post_pool p${joinSql}${whereSql} ORDER BY p.priority DESC, p.created_at DESC LIMIT ? OFFSET ?`,
    [...params, Number(limit) || 50, Number(offset) || 0],
  );
  const posts = await Promise.all(rows.map(withMediaPreview));
  return { posts, total: Number(total) };
}

export async function getById(id) {
  const rows = await query('SELECT * FROM post_pool WHERE id = ?', [id]);
  if (!rows.length) throw ApiError.notFound('post not found');
  return rows[0];
}

// Comments live on the FEED post. A photo's platform_post_id is the bare photo-object
// id (no usable comments edge → "(#100) nonexisting field (comments)"), so resolve to
// the composite {page}_{post} id (parent_post_id, resolve if missing). Same id-shape
// issue as editCaption. Videos/text comment on their own id.
async function resolveCommentTarget(post, { token, fbPageId } = {}) {
  if (post.media_type !== 'image') return post.platform_post_id;
  return (
    post.parent_post_id ||
    (await fb.resolveParentPostId(post.platform_post_id, { token, fbPageId })) ||
    post.platform_post_id
  );
}

// Tag each comment with the Messenger conversation id it opened via "message a
// commenter" (if any), so the UI can show "Messaged" + deep-link to the thread.
async function attachConversationLinks(comments) {
  const ids = comments.map((c) => c.id).filter(Boolean);
  if (!ids.length) return comments;
  const links = await query(
    `SELECT comment_id, conversation_id FROM comment_conversations WHERE comment_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  const byComment = new Map(links.map((l) => [String(l.comment_id), Number(l.conversation_id)]));
  return comments.map((c) => ({ ...c, conversationId: byComment.get(String(c.id)) ?? null }));
}

// A page of live Facebook comments for a published post (proxied from the Graph
// API). Non-published posts have nothing on Facebook yet → empty.
export async function listComments(id, { after = null, limit = 25 } = {}) {
  const post = await getById(id); // existence
  if (post.status !== 'posted' || !post.platform_post_id) return { comments: [], nextCursor: null };
  const lim = Math.min(Math.max(Number(limit) || 25, 1), 50);
  const { token, fbPageId } = await pageCtx(post);
  const commentTarget = await resolveCommentTarget(post, { token, fbPageId });
  try {
    const result = await fb.listComments(commentTarget, { after: after || null, limit: lim }, token);
    // Tag any comment already messaged via "message a commenter" with its conversation id,
    // so the post view can show "Messaged" + deep-link to the thread.
    result.comments = await attachConversationLinks(result.comments || []);
    return result;
  } catch (err) {
    // The post no longer exists on Facebook (deleted there) → mark it 'deleted'
    // here and tell the viewer, so the user can re-post or remove it.
    if (fb.isObjectGoneError(err)) {
      await query("UPDATE post_pool SET status = 'deleted' WHERE id = ?", [id]);
      return { comments: [], nextCursor: null, postDeleted: true };
    }
    throw err;
  }
}

// --- Comments inbox (Contents → Comments) -----------------------------------
// A flat, newest-first feed of live Facebook comments aggregated across a page's
// published posts, with team-shared "handled" state. Bounded for cost: only posts
// that already carry cached comments are scanned, capped to the most recent N.
const FEED_MAX_POSTS = 40; // posts scanned per feed load (newest, with comments)
const FEED_PER_POST = 50; // comments pulled from each post (one Graph page)
const FEED_CONCURRENCY = 5; // bounded parallel Graph calls
const FEED_RETURN_CAP = 200; // max comments returned in one feed response

export async function listCommentFeed({ accountId, filter = 'all' } = {}) {
  const empty = { comments: [], posts: {}, truncated: false, scannedPosts: 0 };
  if (accountId == null) return empty;

  // Candidate posts: this page's published posts that have comments, newest first.
  // One extra row tells us whether older commented posts were left unscanned.
  const posts = await query(
    `SELECT * FROM post_pool
      WHERE account_id = ? AND status = 'posted' AND platform_post_id IS NOT NULL AND comments_count > 0
      ORDER BY posted_at DESC
      LIMIT ?`,
    [accountId, FEED_MAX_POSTS + 1],
  );
  let truncated = posts.length > FEED_MAX_POSTS;
  const scanPosts = posts.slice(0, FEED_MAX_POSTS);
  if (!scanPosts.length) return empty;

  // The page token is shared across an account's posts — resolve once.
  const { token, fbPageId } = await pageCtx(scanPosts[0]);

  // Light per-post descriptor for the list rows (thumbnail presigned once each).
  const postsOut = {};
  await Promise.all(
    scanPosts.map(async (p) => {
      let thumbnailUrl = null;
      if (p.thumbnail_s3_key) {
        try {
          thumbnailUrl = await createDownloadUrl(p.thumbnail_s3_key);
        } catch {
          /* S3 not configured / object missing */
        }
      }
      postsOut[p.id] = {
        id: p.id,
        caption: p.caption,
        mediaType: p.media_type,
        thumbnailUrl,
        comments_count: p.comments_count,
        postedAt: p.posted_at,
      };
    }),
  );

  // Pull each post's comments from Graph with bounded concurrency. A post that's gone
  // on Facebook is marked 'deleted' and dropped; a transient failure just skips that
  // post — one bad post never fails the whole feed.
  const all = [];
  for (let i = 0; i < scanPosts.length; i += FEED_CONCURRENCY) {
    const batch = scanPosts.slice(i, i + FEED_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (p) => {
        const commentTarget = await resolveCommentTarget(p, { token, fbPageId });
        try {
          const { comments } = await fb.listComments(commentTarget, { limit: FEED_PER_POST }, token);
          return comments.map((c) => ({ ...c, postId: p.id }));
        } catch (err) {
          if (fb.isObjectGoneError(err)) {
            await query("UPDATE post_pool SET status = 'deleted' WHERE id = ?", [p.id]);
            delete postsOut[p.id];
          }
          return [];
        }
      }),
    );
    for (const r of results) all.push(...r);
  }
  if (!all.length) return { ...empty, posts: postsOut, scannedPosts: scanPosts.length };

  // Newest first across every post.
  all.sort((a, b) => new Date(b.created_time) - new Date(a.created_time));

  // Attach team-shared handled state + conversation links.
  const commentIds = all.map((c) => c.id).filter(Boolean);
  const statusByComment = new Map();
  if (commentIds.length) {
    const rows = await query(
      `SELECT comment_id, status, handled_by_name, handled_at
         FROM post_comment_status
        WHERE account_id = ? AND comment_id IN (${commentIds.map(() => '?').join(',')})`,
      [accountId, ...commentIds],
    );
    for (const r of rows) statusByComment.set(String(r.comment_id), r);
  }
  const linked = await attachConversationLinks(all);

  const shaped = [];
  for (const c of linked) {
    if (!postsOut[c.postId]) continue; // its post was just found deleted
    const st = statusByComment.get(String(c.id));
    const handled = !!(st && st.status === 'done');
    if (filter === 'open' && handled) continue;
    if (filter === 'done' && !handled) continue;
    shaped.push({
      id: c.id,
      postId: c.postId,
      message: c.message,
      created_time: c.created_time,
      authorName: c.authorName || null,
      handled,
      handledBy: handled ? st.handled_by_name || null : null,
      handledAt: handled ? st.handled_at : null,
      conversationId: c.conversationId ?? null,
    });
    if (shaped.length >= FEED_RETURN_CAP) {
      truncated = true;
      break;
    }
  }

  return { comments: shaped, posts: postsOut, truncated, scannedPosts: scanPosts.length };
}

// Set (or clear) the team-shared "handled" flag for a comment. status 'done' upserts a
// row; 'open' deletes it (absence = open). `postId` is advisory context, validated to
// belong to the active page. `actor` = { id, name } records who handled it.
export async function setCommentStatus({ accountId, postId = null, commentId, status = 'done', actor = {} } = {}) {
  if (accountId == null) throw ApiError.badRequest('no active page selected');
  if (!commentId) throw ApiError.badRequest('a comment id is required');
  const st = status === 'open' ? 'open' : 'done';

  let pid = postId != null && postId !== '' ? Number(postId) : null;
  if (pid != null) {
    const rows = await query('SELECT account_id FROM post_pool WHERE id = ?', [pid]);
    if (!rows.length || Number(rows[0].account_id) !== Number(accountId)) pid = null; // ignore mismatched context
  }

  if (st === 'open') {
    await query('DELETE FROM post_comment_status WHERE account_id = ? AND comment_id = ?', [accountId, String(commentId)]);
    return { commentId: String(commentId), status: 'open', handled: false };
  }
  await query(
    `INSERT INTO post_comment_status (account_id, comment_id, post_id, status, handled_by_id, handled_by_name)
          VALUES (?, ?, ?, 'done', ?, ?)
     ON DUPLICATE KEY UPDATE post_id = VALUES(post_id), status = 'done',
          handled_by_id = VALUES(handled_by_id), handled_by_name = VALUES(handled_by_name), updated_at = CURRENT_TIMESTAMP`,
    [accountId, String(commentId), pid, actor.id ?? null, actor.name || null],
  );
  return { commentId: String(commentId), status: 'done', handled: true, handledBy: actor.name || null };
}

// Post a reply to a Facebook comment AS THE PAGE, from the post view. `commentId` is a
// comment's own id (from listComments) — replies attach directly to it, so no photo/feed
// id-shape concern here. Needs `pages_manage_engagement` on the page token.
export async function replyToComment(id, commentId, message) {
  const body = String(message ?? '').trim();
  if (!body) throw ApiError.badRequest('a reply message is required');
  if (!commentId) throw ApiError.badRequest('a comment id is required');
  const post = await getById(id); // existence — must be a published post of this page
  if (post.status !== 'posted' || !post.platform_post_id) {
    throw ApiError.badRequest('you can only reply to comments on a published post');
  }
  // Fast-fail on a known-dead page token (same guard as editCaption) so a definite bad
  // token returns a clear 409 instead of a Facebook rejection.
  if (post.account_id) {
    const health = await accounts.checkConnection(post.account_id);
    if (health && health.ok === false && (health.reason === 'invalid_token' || health.reason === 'no_token')) {
      throw new ApiError(409, "This page's Facebook connection has expired. Reconnect it in Settings → Pages, then try again.");
    }
  }
  const { token } = await pageCtx(post);
  return fb.replyToComment(commentId, body, token);
}

// "Message a commenter" (Comment → DM): send a Messenger PRIVATE REPLY to the person who
// left `commentId` (Facebook hides their PSID, so we address them by the comment id), then
// open/record the conversation in the inbox owned by the acting user. Facebook allows this
// once per comment within 7 days. Returns { conversationId, created }.
export async function messageCommenter(id, commentId, { message } = {}, actor = {}) {
  const body = String(message ?? '').trim();
  if (!body) throw ApiError.badRequest('a message is required');
  if (!commentId) throw ApiError.badRequest('a comment id is required');
  const post = await getById(id); // existence — must be a published post of this page
  if (post.status !== 'posted' || !post.platform_post_id) {
    throw ApiError.badRequest('you can only message commenters on a published post');
  }
  if (!post.account_id) throw ApiError.badRequest('this post is not linked to a connected page');

  // Fast-fail on a known-dead page token (same guard as editCaption/reply).
  const health = await accounts.checkConnection(post.account_id);
  if (health && health.ok === false && (health.reason === 'invalid_token' || health.reason === 'no_token')) {
    throw new ApiError(409, "This page's Facebook connection has expired. Reconnect it in Settings → Pages, then try again.");
  }

  // If THIS comment was already messaged and its thread is a Live-Agent chat owned by a
  // DIFFERENT agent, refuse UP FRONT — don't fire a second private reply into a thread the
  // actor can't see. (This is the only case we can catch pre-send: for a different comment
  // by the same person, Facebook hides the PSID until privateReplyToComment returns below.)
  const prior = await query(
    `SELECT c.handled_by, c.assigned_user_id, c.assigned_user_name
       FROM comment_conversations cc JOIN conversations c ON c.id = cc.conversation_id
      WHERE cc.comment_id = ? LIMIT 1`,
    [String(commentId)],
  );
  if (prior.length) {
    const c = prior[0];
    if (c.handled_by === 'Live Agent' && c.assigned_user_id != null && Number(c.assigned_user_id) !== Number(actor?.id)) {
      throw new ApiError(409, `This comment is already handled by ${c.assigned_user_name || 'another agent'}. Request a transfer in Messages to reply.`);
    }
  }

  const { token } = await pageCtx(post);
  const sent = await fb.privateReplyToComment(token, commentId, body);
  if (!sent.ok || !sent.recipientId) {
    // 422 (not 5xx) so the real Facebook reason reaches the browser instead of a masked CORS error.
    throw new ApiError(422, `Couldn't send the private message on Facebook: ${sent.error || 'unknown error'}`);
  }

  // Open/record the conversation (page-initiated outbound). The message is ALREADY delivered
  // via the private reply above; handled_by 'Live Agent' means receiveInbound won't re-send it.
  const result = await messaging.receiveInbound({
    accountId: post.account_id,
    customerHandle: sent.recipientId, // the PSID Facebook returned
    customerName: 'Facebook user', // FB withholds the commenter's name; heals on their reply
    origin: 'messenger',
    handledBy: 'Live Agent',
    side: 'outgoing',
    text: body,
    externalId: sent.messageId,
    incrementUnread: false,
    createIfMissing: true,
  });

  // Resolve ownership of the thread the message landed in. receiveInbound flips ANY reused
  // thread to 'Live Agent' but never assigns it, so we settle it here: claim the thread for
  // the agent who reached out (brand-new, or a Live-Agent thread nobody owns yet — including
  // one just flipped from AI) UNLESS another agent already owns it, which we never steal.
  const owned = await query(
    'SELECT assigned_user_id, assigned_user_name FROM conversations WHERE id = ?',
    [result.conversationId],
  );
  const ownerId = owned.length && owned[0].assigned_user_id != null ? Number(owned[0].assigned_user_id) : null;
  const ownedByOther = ownerId != null && ownerId !== Number(actor?.id);
  if (actor?.id && !ownedByOther) {
    await query('UPDATE conversations SET assigned_user_id = ?, assigned_user_name = ? WHERE id = ?', [
      actor.id,
      actor.name || '',
      result.conversationId,
    ]);
  }
  // Remember which comment opened this conversation, so the post view can show "Messaged"
  // and deep-link to the thread on a later visit (survives reloads).
  await query(
    'INSERT INTO comment_conversations (comment_id, conversation_id, account_id) VALUES (?, ?, ?) ' +
      'ON DUPLICATE KEY UPDATE conversation_id = VALUES(conversation_id)',
    [String(commentId), result.conversationId, post.account_id],
  );
  // ownedByOther: the message WAS delivered (into the other agent's thread), but the actor
  // can't open it — the client shows an informational notice instead of a 403.
  return {
    conversationId: String(result.conversationId),
    created: !!result.created,
    ownedByOther,
    ownerName: ownedByOther ? owned[0].assigned_user_name || 'another agent' : null,
  };
}

// `actor` = { id, name } of the signed-in user creating the post (recorded as
// the creator + logged to the activity trail).
export async function create(actor = {}, data = {}) {
  const {
    caption = null,
    media_type = null,
    post_kind = 'post',
    media_url = null,
    s3_key = null,
    thumbnail_s3_key = null,
    target_platform = 'facebook',
    status = 'ready',
    priority = 0,
    scheduled_at = null,
    immediate = false,
  } = data;
  // A post needs at least one of media or caption — only one may be empty.
  // Caption is required only for a text-only post (no media); when media is
  // present the caption is optional.
  const hasMedia = !!(media_url || s3_key);
  const hasCaption = !!(caption && String(caption).trim());
  if (!hasMedia && !hasCaption) throw ApiError.badRequest('a caption or media is required');
  if (status && !ALLOWED_STATUS.includes(status)) throw ApiError.badRequest(`invalid status: ${status}`);
  if (media_type && !ALLOWED_MEDIA.includes(media_type)) throw ApiError.badRequest(`invalid media_type: ${media_type}`);
  if (!ALLOWED_KINDS.includes(post_kind)) throw ApiError.badRequest(`invalid post_kind: ${post_kind}`);
  // A reel or feed-video must carry a video (the client also gates reel eligibility
  // on duration/aspect; the server can't probe the file, so it enforces the basics).
  if ((post_kind === 'reel' || post_kind === 'video') && !(hasMedia && media_type === 'video')) {
    throw ApiError.badRequest(`a ${post_kind} requires a video file`);
  }

  // "Post now" (immediate) is handed straight to n8n via the webhook below, not
  // the scheduled drain: scheduled_at stays NULL so claimNextBatch / expireOverdue
  // skip it, and it goes in as 'posting' until n8n marks it posted/failed.
  // Scheduled posts keep the slot-checked :00/:30 path.
  const isImmediate = truthy(immediate);
  let schedule;
  if (isImmediate) {
    if (!env.n8n.postWebhookUrl) {
      throw new ApiError(503, 'Immediate posting is disabled: N8N_POST_WEBHOOK_URL (or N8N_GENERATE_WEBHOOK_URL) is not configured');
    }
    schedule = null;
  } else {
    schedule = normalizeScheduledAt(scheduled_at);
    if (!schedule) throw ApiError.badRequest('a schedule date and time is required');
    if (schedule.getTime() <= Date.now()) throw ApiError.badRequest('the scheduled time must be in the future');
    await assertSlotFree(schedule);
  }

  // Tag the post with the creator's active page (null = none selected → the
  // scheduler/posting falls back to the env page during rollout).
  const accountId = actor.id != null ? await getSelectedAccountId(actor.id) : null;
  const result = await query(
    `INSERT INTO post_pool (user_id, caption, media_type, post_kind, media_url, s3_key, thumbnail_s3_key, target_platform, account_id, status, priority, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [actor.id, caption, media_type, post_kind, media_url, s3_key, thumbnail_s3_key, target_platform, accountId, isImmediate ? 'posting' : status, Number(priority) || 0, schedule],
  );
  await activity.log({
    postId: result.insertId,
    userId: actor.id,
    userName: actor.name,
    action: 'created',
    details: hasCaption ? String(caption).slice(0, 120) : '(media only)',
  });

  // Immediate posts: fire the n8n publish webhook now. A trigger failure must not
  // strand the post in 'posting' (it's invisible to the scheduled claim) — mark it
  // failed and surface the error to the caller.
  if (isImmediate) {
    try {
      await triggerImmediatePost({ id: result.insertId, caption, media_type, post_kind, s3_key, accountId, target_platform });
    } catch (err) {
      await query("UPDATE post_pool SET status = 'failed', failed_reason = ? WHERE id = ?", [
        String(`n8n trigger failed: ${err.message}`).slice(0, 1000),
        result.insertId,
      ]);
      throw new ApiError(502, `couldn't reach the posting webhook: ${err.message}`);
    }
  }

  return getById(result.insertId);
}

// Push a "Post now" post to the n8n "Post to n8n" webhook for immediate
// publishing. Mirrors the scheduled drain payload (data.post with a presigned
// media URL + the page's decrypted creds) so the same posting nodes consume it;
// `for_automation: false` routes n8n's IF to the publish branch (not generate).
async function triggerImmediatePost({ id, caption, media_type, post_kind = 'post', s3_key, accountId, target_platform }) {
  let media_download_url = null;
  if (s3_key) {
    try {
      media_download_url = await createDownloadUrl(s3_key);
    } catch {
      /* S3 not configured / object missing — n8n will fail the media post */
    }
  }
  let page = null;
  if (accountId) {
    try {
      const a = await accounts.getDecrypted(accountId);
      page = { fb_page_id: a.fb_page_id, access_token: a.access_token };
    } catch {
      /* page gone / encryption unavailable — n8n falls back to its own creds */
    }
  }

  const headers = { 'Content-Type': 'application/json' };
  if (env.n8n.webhookToken) headers['x-service-token'] = env.n8n.webhookToken;

  const res = await fetch(env.n8n.postWebhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      for_automation: false,
      data: { claimed: true, post: { id, caption, media_type, post_kind, media_download_url, target_platform, page } },
    }),
    signal: AbortSignal.timeout(30 * 1000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`webhook ${res.status}: ${String(body).slice(0, 200)}`);
  }
}

// Retry a failed/expired post by re-publishing it NOW through the n8n webhook —
// the same immediate path as "Post now". This bypasses the scheduler's slot +
// overdue rules, so a post whose scheduled time already passed can still go out
// without picking a new future slot. Flips it to 'posting' up front (clearing the
// old failure) so a duplicate click can't double-publish and the scheduler never
// eyes it; n8n reports the outcome back via /posts/:id/posted|failed.
export async function retryNow(id, actor = {}) {
  const post = await getById(id); // 404 if missing
  if (post.status !== 'failed' && post.status !== 'expired' && post.status !== 'deleted') {
    throw ApiError.badRequest(`only failed, expired, or deleted posts can be retried (this one is '${post.status}')`);
  }
  if (!env.n8n.postWebhookUrl) {
    throw new ApiError(503, 'Retry is disabled: N8N_POST_WEBHOOK_URL (or N8N_GENERATE_WEBHOOK_URL) is not configured');
  }

  await query("UPDATE post_pool SET status = 'posting', failed_reason = NULL WHERE id = ?", [id]);
  try {
    await triggerImmediatePost({
      id: post.id,
      caption: post.caption,
      media_type: post.media_type,
      post_kind: post.post_kind,
      s3_key: post.s3_key,
      accountId: post.account_id,
      target_platform: post.target_platform,
    });
  } catch (err) {
    await query("UPDATE post_pool SET status = 'failed', failed_reason = ? WHERE id = ?", [
      String(`n8n retry trigger failed: ${err.message}`).slice(0, 1000),
      id,
    ]);
    throw new ApiError(502, `couldn't reach the posting webhook: ${err.message}`);
  }

  await activity.log({
    postId: id,
    userId: actor.id,
    userName: actor.name,
    action: 'edited',
    details: 'retried (immediate publish)',
  });
  return getById(id);
}

// `actor` = { id, name } of the editor (logged to the activity trail).
export async function update(id, data = {}, actor = {}) {
  const existing = await getById(id); // existence check

  const editable = ['caption', 'media_type', 'media_url', 's3_key', 'thumbnail_s3_key', 'target_platform', 'status', 'priority', 'scheduled_at'];
  const fields = [];
  const params = [];
  const changed = [];
  let newSchedule = null;
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
      if (!value) throw ApiError.badRequest('a schedule date and time is required');
      // Moving the schedule to a past slot is rejected — the scheduler could never
      // run it. Re-saving the SAME time is allowed, so caption edits on an already-
      // posted or failed post (which carry their original past time) still go through.
      const moved = !existing.scheduled_at || value.getTime() !== new Date(existing.scheduled_at).getTime();
      if (moved && value.getTime() <= Date.now()) {
        throw ApiError.badRequest('the scheduled time must be in the future');
      }
      await assertSlotFree(value, id);
      newSchedule = value;
    }
    fields.push(`${key} = ?`);
    params.push(value);
    changed.push(key);
  }

  // Push a caption change to Facebook for an already-published post, so an
  // in-app edit keeps the live post in sync. Done before the local write so a
  // Facebook failure aborts the update (no silent divergence).
  if (
    'caption' in data &&
    data.caption !== existing.caption &&
    existing.status === 'posted' &&
    existing.platform_post_id
  ) {
    // Fast-fail on a known-dead page token instead of firing a Graph edit that would
    // just be rejected (or, on a slow endpoint, stall). The health check is cached
    // (populated at app start, 5-min TTL), so this is near-instant on the common path.
    // Only a DEFINITIVE bad token blocks — a transient 'unknown' still proceeds, so a
    // Facebook/network hiccup never locks editing.
    if (existing.account_id) {
      const health = await accounts.checkConnection(existing.account_id);
      if (health && health.ok === false && (health.reason === 'invalid_token' || health.reason === 'no_token')) {
        throw new ApiError(409, "This page's Facebook connection has expired. Reconnect it in Settings → Pages, then try saving again.");
      }
    }
    const { token, fbPageId } = await pageCtx(existing);
    // A photo's stored platform_post_id is the bare PHOTO-object id, which Facebook
    // won't edit via `message` (it returns "object does not exist / unsupported"). The
    // editable object is the composite {page}_{post} FEED id — kept in parent_post_id
    // (resolve on the fly if it was never backfilled). Videos/text edit their own id
    // (the video object / the already-composite feed post), so leave those as-is.
    let editTarget = existing.platform_post_id;
    if (existing.media_type === 'image') {
      editTarget =
        existing.parent_post_id ||
        (await fb.resolveParentPostId(existing.platform_post_id, { token, fbPageId })) ||
        existing.platform_post_id;
    }
    await fb.editCaption(editTarget, existing.media_type, data.caption, token);
  }

  // Reviving a failed or expired post: when an edit leaves it with a future
  // scheduled time (just rescheduled, or already future) and the caller didn't set
  // an explicit status, flip it back to 'ready' so the scheduler retries it — and
  // clear the now-stale failure reason. A post still timed in the past isn't revived
  // (it would only expire again): reschedule it to a future slot to retry.
  const effectiveSchedule = newSchedule || existing.scheduled_at;
  const retryable = existing.status === 'failed' || existing.status === 'expired';
  if (retryable && !('status' in data) && effectiveSchedule && new Date(effectiveSchedule).getTime() > Date.now()) {
    fields.push('status = ?');
    params.push('ready');
    fields.push('failed_reason = ?');
    params.push(null);
    changed.push('status:revived');
  }

  if (fields.length) {
    params.push(id);
    await query(`UPDATE post_pool SET ${fields.join(', ')} WHERE id = ?`, params);
    await activity.log({
      postId: id,
      userId: actor.id,
      userName: actor.name,
      action: 'edited',
      details: `changed: ${changed.join(', ')}`,
    });
  }
  return getById(id);
}

// `actor` = { id, name } of the deleter (logged to the activity trail).
export async function remove(id, actor = {}) {
  const post = await getById(id); // existence check (also gives s3_key)
  // Delete the live Facebook post first (only published posts carry a platform
  // id). A real FB failure throws and aborts, so the record stays and the user
  // can retry; an already-deleted FB post is treated as success.
  if (post.status === 'posted' && post.platform_post_id) {
    const { token } = await pageCtx(post);
    await fb.deletePost(post.platform_post_id, token);
  }
  await query('DELETE FROM post_pool WHERE id = ?', [id]);
  if (post.s3_key) await deleteObject(post.s3_key); // best-effort: clean up the media in S3
  if (post.thumbnail_s3_key) await deleteObject(post.thumbnail_s3_key); // and its thumbnail
  await activity.log({
    postId: null, // row is gone (the FK would null it anyway)
    userId: actor.id,
    userName: actor.name,
    action: 'deleted',
    details: `#${id}${post.caption ? ` — ${String(post.caption).slice(0, 100)}` : ''}`,
  });
  return { id: Number(id), deleted: true };
}

// Status breakdown for the dashboard, scoped to the caller's active page.
export async function counts(accountId = null) {
  const out = { draft: 0, ready: 0, posting: 0, posted: 0, failed: 0, archived: 0, total: 0 };
  if (accountId == null) return out; // no active page → all zero (see list())
  const rows = await query(
    'SELECT status, COUNT(*) AS count FROM post_pool WHERE account_id = ? GROUP BY status',
    [accountId],
  );
  for (const r of rows) {
    out[r.status] = Number(r.count);
    out.total += Number(r.count);
  }
  return out;
}

// Refresh engagement for the published posts in `posts` straight from Facebook (one
// Graph batch) and persist the new counts. Bounded to whatever's passed in — one
// page of the pool — so cost stays flat no matter how big the pool grows. Stale-
// only (TTL) so repeat views are cheap, and best-effort throughout: any failure
// leaves the last-known counts untouched. Mutates and returns the same `posts`.
export async function refreshEngagement(posts = [], { force = false } = {}) {
  const stale = posts.filter(
    (p) => p.status === 'posted' && p.platform_post_id && (force || engagementStale(p.engagement_synced_at)),
  );
  if (!stale.length) return posts;

  // Group by connected page so each Graph batch uses that page's token. Backfill
  // any missing feed-story id (so `shares` can be read) within each group.
  const groups = new Map(); // account_id (0 = untagged/env) -> posts[]
  for (const p of stale) {
    const k = p.account_id ?? 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const counts = new Map();
  for (const group of groups.values()) {
    const { token, fbPageId } = await pageCtx(group[0]);
    for (const p of group) {
      if (!p.parent_post_id) {
        const parent = await fb.resolveParentPostId(p.platform_post_id, { token, fbPageId }).catch(() => null);
        if (parent) {
          await query('UPDATE post_pool SET parent_post_id = ? WHERE id = ?', [parent, p.id]);
          p.parent_post_id = parent;
        }
      }
    }
    try {
      const part = await fb.fetchEngagementBatch(group, token);
      for (const [id, v] of part) counts.set(id, v);
    } catch {
      /* this page unreachable — keep cached numbers for its posts */
    }
  }

  for (const p of stale) {
    const c = counts.get(p.id);
    if (!c) continue; // every metric failed for this post → leave it as-is
    // Merge: a metric that came back wins; one that didn't keeps its last value.
    const reactions = c.reactions ?? p.reactions_count ?? null;
    const comments = c.comments ?? p.comments_count ?? null;
    const shares = c.shares ?? p.shares_count ?? null;
    const views = c.views ?? p.views_count ?? null;
    const watchTime = c.watchTime ?? p.video_watch_time_s ?? null;
    const avgWatch = c.avgWatch ?? p.video_avg_watch_s ?? null;
    await query(
      `UPDATE post_pool
          SET reactions_count = ?, comments_count = ?, shares_count = ?, views_count = ?,
              video_watch_time_s = ?, video_avg_watch_s = ?,
              engagement_synced_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [reactions, comments, shares, views, watchTime, avgWatch, p.id],
    );
    // Record this hour's snapshot so insights can be plotted over time.
    await recordInsightSnapshot(p.id, { reactions, comments, shares, views });
    Object.assign(p, {
      reactions_count: reactions,
      comments_count: comments,
      shares_count: shares,
      views_count: views,
      video_watch_time_s: watchTime,
      video_avg_watch_s: avgWatch,
      engagement_synced_at: new Date().toISOString(),
    });
  }
  return posts;
}

// Time-series for one metric of one post, from the recorded snapshots.
// granularity: 'hour' (raw hourly points, returned as ISO-UTC so the client can
// localize) | 'day' | 'month' (aggregated — peak per bucket; counts are ~monotonic
// so peak ≈ end-of-bucket). Refreshes the post first (best-effort) so the current
// point exists when the drawer opens.
export async function insights(postId, { metric = 'reactions', granularity = 'day' } = {}) {
  const col = INSIGHT_METRICS[metric];
  if (!col) throw ApiError.badRequest(`invalid metric (one of: ${Object.keys(INSIGHT_METRICS).join(', ')})`);

  const post = await getById(postId); // 404 if missing; full row for the refresh
  await refreshEngagement([post]); // best-effort fresh pull + this hour's snapshot

  let rows;
  if (granularity === 'hour') {
    rows = await query(
      `SELECT DATE_FORMAT(captured_at, '%Y-%m-%dT%H:00:00Z') AS period, ${col} AS value
         FROM post_insight_history
        WHERE post_id = ? AND ${col} IS NOT NULL
        ORDER BY captured_at ASC`,
      [postId],
    );
  } else if (granularity === 'month') {
    rows = await query(
      `SELECT DATE_FORMAT(captured_at, '%Y-%m') AS period, MAX(${col}) AS value
         FROM post_insight_history
        WHERE post_id = ? AND ${col} IS NOT NULL
        GROUP BY period
        ORDER BY period ASC`,
      [postId],
    );
  } else {
    rows = await query(
      `SELECT DATE_FORMAT(captured_at, '%Y-%m-%d') AS period, MAX(${col}) AS value
         FROM post_insight_history
        WHERE post_id = ? AND ${col} IS NOT NULL
        GROUP BY period
        ORDER BY period ASC`,
      [postId],
    );
  }

  const g = granularity === 'hour' ? 'hour' : granularity === 'month' ? 'month' : 'day';
  return { metric, granularity: g, points: rows.map((r) => ({ period: r.period, value: Number(r.value) })) };
}

// Upsert this hour's engagement snapshot for a post. Best-effort: a missing table
// or write error must never break the caller (refresh / scheduled snapshot).
async function recordInsightSnapshot(postId, { reactions, comments, shares, views }) {
  try {
    await query(
      `INSERT INTO post_insight_history (post_id, captured_at, reactions_count, comments_count, shares_count, views_count)
            VALUES (?, DATE_FORMAT(UTC_TIMESTAMP(), '%Y-%m-%d %H:00:00'), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
            reactions_count = COALESCE(VALUES(reactions_count), reactions_count),
            comments_count  = COALESCE(VALUES(comments_count), comments_count),
            shares_count    = COALESCE(VALUES(shares_count), shares_count),
            views_count     = COALESCE(VALUES(views_count), views_count)`,
      [postId, reactions, comments, shares, views],
    );
  } catch {
    /* history is auxiliary — never break the caller */
  }
}

// Scheduled snapshot (called by n8n via /api/scheduler/insights/snapshot): pull
// fresh engagement for recently-published posts in one batch and record this
// hour's point for each. Scoped to the last FRESH_INSIGHT_DAYS days — older posts
// barely move, so their history is left frozen.
const FRESH_INSIGHT_DAYS = 7;
export async function snapshotRecentInsights() {
  const rows = await query(
    `SELECT id, platform_post_id, parent_post_id, media_type, account_id,
            reactions_count, comments_count, shares_count, views_count,
            video_watch_time_s, video_avg_watch_s
       FROM post_pool
      WHERE status = 'posted' AND platform_post_id IS NOT NULL
        AND posted_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)
      ORDER BY posted_at DESC`,
    [FRESH_INSIGHT_DAYS],
  );
  if (!rows.length) return { scanned: 0, recorded: 0 };

  // Recent posts can span several pages — batch each page with its own token.
  const groups = new Map();
  for (const p of rows) {
    const k = p.account_id ?? 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  }
  const counts = new Map();
  for (const group of groups.values()) {
    const { token } = await pageCtx(group[0]);
    try {
      const part = await fb.fetchEngagementBatch(group, token);
      for (const [id, v] of part) counts.set(id, v);
    } catch {
      /* this page unreachable — skip its posts this run */
    }
  }

  let recorded = 0;
  for (const p of rows) {
    const c = counts.get(p.id);
    if (!c) continue;
    const reactions = c.reactions ?? p.reactions_count ?? null;
    const comments = c.comments ?? p.comments_count ?? null;
    const shares = c.shares ?? p.shares_count ?? null;
    const views = c.views ?? p.views_count ?? null;
    const watchTime = c.watchTime ?? p.video_watch_time_s ?? null;
    const avgWatch = c.avgWatch ?? p.video_avg_watch_s ?? null;
    await query(
      `UPDATE post_pool
          SET reactions_count = ?, comments_count = ?, shares_count = ?, views_count = ?,
              video_watch_time_s = ?, video_avg_watch_s = ?,
              engagement_synced_at = UTC_TIMESTAMP()
        WHERE id = ?`,
      [reactions, comments, shares, views, watchTime, avgWatch, p.id],
    );
    await recordInsightSnapshot(p.id, { reactions, comments, shares, views });
    recorded += 1;
  }
  return { scanned: rows.length, recorded };
}
