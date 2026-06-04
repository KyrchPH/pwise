import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

// The caption lives in a different Graph field per media type.
function captionField(mediaType) {
  if (mediaType === 'video') return 'description'; // videos / reels (verified editable)
  if (mediaType === 'image') return 'caption'; // photos
  return 'message'; // text / link feed posts
}

// Thin Graph API call against a single object id. The access token rides in the
// query string for GET/DELETE and in the form body for POST.
async function graph(id, { method = 'GET', fields = {} } = {}) {
  if (!env.facebook.pageAccessToken) {
    throw new ApiError(503, 'Facebook is not configured (FACEBOOK_PAGE_ACCESS_TOKEN missing)');
  }
  const params = new URLSearchParams({ ...fields, access_token: env.facebook.pageAccessToken });
  const url = `https://graph.facebook.com/${env.facebook.graphVersion}/${id}`;
  let res;
  try {
    res = method === 'POST'
      ? await fetch(url, { method, body: params })
      : await fetch(`${url}?${params.toString()}`, { method });
  } catch (err) {
    throw new ApiError(502, `Facebook request failed: ${err.message}`);
  }
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok && !data.error, error: data.error || null, data };
}

// POST a Graph API batch (array of { method, relative_url }, up to 50) in ONE
// HTTP call. The page token rides in the form body and every sub-request inherits
// it. Returns the raw results array [{ code, body }, …] where `body` is a JSON
// string. Throws on a transport or top-level error (e.g. a bad token comes back
// as an error object, not an array).
async function graphBatch(ops) {
  if (!env.facebook.pageAccessToken) {
    throw new ApiError(503, 'Facebook is not configured (FACEBOOK_PAGE_ACCESS_TOKEN missing)');
  }
  const body = new URLSearchParams({
    access_token: env.facebook.pageAccessToken,
    batch: JSON.stringify(ops),
  });
  let res;
  try {
    res = await fetch(`https://graph.facebook.com/${env.facebook.graphVersion}/`, { method: 'POST', body });
  } catch (err) {
    throw new ApiError(502, `Facebook batch request failed: ${err.message}`);
  }
  const data = await res.json().catch(() => null);
  if (!Array.isArray(data)) {
    throw new ApiError(502, `Facebook batch failed: ${data?.error?.message || 'unexpected response'}`);
  }
  return data;
}

// Delete a published post/video/photo by its platform id. A post that's already
// gone on Facebook is treated as success so the local record can still be removed.
export async function deletePost(platformPostId) {
  const { ok, error } = await graph(platformPostId, { method: 'DELETE' });
  if (ok) return { deleted: true };
  const msg = error?.message || 'unknown error';
  if (/do(es)?\s*not exist|cannot be loaded|Unsupported \w+ request/i.test(msg)) {
    return { deleted: true, alreadyGone: true };
  }
  throw new ApiError(502, `Couldn't delete the post on Facebook: ${msg}`);
}

// Edit a published post's caption. The target field depends on media type.
export async function editCaption(platformPostId, mediaType, caption) {
  const { ok, error } = await graph(platformPostId, {
    method: 'POST',
    fields: { [captionField(mediaType)]: caption ?? '' },
  });
  if (ok) return { edited: true };
  throw new ApiError(502, `Couldn't update the caption on Facebook: ${error?.message || 'unknown error'}`);
}

// One page of comment content for a published post, oldest first. NOTE: Facebook
// withholds the commenter's identity (`from`) for ordinary users even with
// pages_read_user_content — verified 2026-06-03 that `from` is simply omitted
// from the response (privacy) — so we surface message + time only.
export async function listComments(platformPostId, { after = null, limit = 25 } = {}) {
  const fields = { fields: 'message,created_time', order: 'chronological', limit: String(limit) };
  if (after) fields.after = after;
  const { ok, error, data } = await graph(`${platformPostId}/comments`, { fields });
  if (!ok) throw new ApiError(502, `Couldn't load comments from Facebook: ${error?.message || 'unknown error'}`);
  return {
    comments: (data.data || []).map((c) => ({ id: c.id, message: c.message || '', created_time: c.created_time })),
    nextCursor: data.paging?.next ? data.paging.cursors?.after ?? null : null,
  };
}

// Resolve a published post's {page}_{post} feed id from its stored platform id, so
// shares can be read per-post (lightweight) instead of a heavy bulk query. Text/
// feed posts already store the {page}_{post}; photo/video posts store an object id
// whose feed post we find via published_posts (attachments.target.id). Best-effort:
// returns null if not found yet (e.g. a video still being indexed) — caller retries.
export async function resolveParentPostId(platformPostId) {
  if (!platformPostId) return null;
  if (String(platformPostId).includes('_')) return platformPostId; // already a {page}_{post}
  if (!env.facebook.pageId) return null;
  try {
    const { ok, data } = await graph(`${env.facebook.pageId}/published_posts`, {
      fields: { fields: 'id,attachments.limit(1){target{id}}', limit: '25' },
    });
    if (!ok) return null;
    for (const p of data.data || []) {
      for (const a of p.attachments?.data || []) {
        if (a.target && String(a.target.id) === String(platformPostId)) return p.id;
      }
    }
  } catch {
    /* best-effort — leave null, backfill later */
  }
  return null;
}

// Read engagement for a set of published posts in ONE Graph batch (≤50 sub-
// requests). Reactions/comments/shares come from the feed story ({page}_{post});
// video views live on the video object, so a video adds a second sub-request.
// Best-effort: a failed sub-request is skipped (caller keeps the last-known value)
// rather than throwing. Returns Map<postId, { reactions?, comments?, shares?,
// views? }> — a key is present only when that metric was read successfully.
export async function fetchEngagementBatch(posts = []) {
  const subs = []; // parallel to ops: { postId, kind, isFeed }
  const ops = [];
  for (const p of posts) {
    const feedId = p.parent_post_id || p.platform_post_id;
    if (feedId) {
      const isFeed = String(feedId).includes('_'); // only feed stories expose `shares`
      const fields = isFeed
        ? 'reactions.summary(true).limit(0),comments.summary(true).limit(0),shares'
        : 'reactions.summary(true).limit(0),comments.summary(true).limit(0)';
      subs.push({ postId: p.id, kind: 'engagement', isFeed });
      ops.push({ method: 'GET', relative_url: `${feedId}?fields=${encodeURIComponent(fields)}` });
    }
    if (p.media_type === 'video' && p.platform_post_id) {
      subs.push({ postId: p.id, kind: 'views' });
      ops.push({ method: 'GET', relative_url: `${p.platform_post_id}?fields=views` });
    }
  }
  if (!ops.length) return new Map();

  const results = await graphBatch(ops);
  const out = new Map();
  const bucket = (id) => {
    if (!out.has(id)) out.set(id, {});
    return out.get(id);
  };
  results.forEach((r, i) => {
    const sub = subs[i];
    if (!sub || !r || r.code >= 400 || !r.body) return; // sub-request failed → skip
    let payload;
    try {
      payload = JSON.parse(r.body);
    } catch {
      return;
    }
    if (!payload || payload.error) return;
    const b = bucket(sub.postId);
    if (sub.kind === 'engagement') {
      if (payload.reactions?.summary) b.reactions = payload.reactions.summary.total_count ?? 0;
      if (payload.comments?.summary) b.comments = payload.comments.summary.total_count ?? 0;
      if (sub.isFeed) b.shares = payload.shares?.count ?? 0; // `shares` is omitted when zero
    } else if (sub.kind === 'views' && payload.views != null) {
      b.views = Number(payload.views);
    }
  });
  return out;
}
