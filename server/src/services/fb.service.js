import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

// Every call targets a specific connected page via its (decrypted) access token.
// `token` falls back to the legacy env token so posts not yet tagged with a page
// (or page-level calls before a page is selected) keep working during rollout.
// fbPageId likewise falls back to env.facebook.pageId.

// The caption lives in a different Graph field per media type.
function captionField(mediaType) {
  if (mediaType === 'video') return 'description'; // videos / reels (verified editable)
  if (mediaType === 'image') return 'caption'; // photos
  return 'message'; // text / link feed posts
}

function tokenOrThrow(token) {
  const t = token || env.facebook.pageAccessToken;
  if (!t) throw new ApiError(503, 'Facebook is not configured (no page access token)');
  return t;
}

// Graph's "object no longer exists / can't be loaded" family — a published object
// that was deleted (or whose permission was lost) on Facebook. Accepts either a
// message string or an Error/ApiError.
const OBJECT_GONE_RE = /do(es)?\s*not exist|cannot be loaded|Unsupported \w+ request/i;
export function isObjectGoneError(messageOrError) {
  const msg = typeof messageOrError === 'string' ? messageOrError : messageOrError?.message || '';
  return OBJECT_GONE_RE.test(msg);
}

// Thin Graph API call against a single object id. The access token rides in the
// query string for GET/DELETE and in the form body for POST.
async function graph(id, { method = 'GET', fields = {}, token } = {}) {
  const params = new URLSearchParams({ ...fields, access_token: tokenOrThrow(token) });
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
// it.
async function graphBatch(ops, token) {
  const body = new URLSearchParams({ access_token: tokenOrThrow(token), batch: JSON.stringify(ops) });
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
export async function deletePost(platformPostId, token) {
  const { ok, error } = await graph(platformPostId, { method: 'DELETE', token });
  if (ok) return { deleted: true };
  const msg = error?.message || 'unknown error';
  if (isObjectGoneError(msg)) {
    return { deleted: true, alreadyGone: true };
  }
  throw new ApiError(502, `Couldn't delete the post on Facebook: ${msg}`);
}

// Edit a published post's caption. The target field depends on media type.
export async function editCaption(platformPostId, mediaType, caption, token) {
  const { ok, error } = await graph(platformPostId, {
    method: 'POST',
    fields: { [captionField(mediaType)]: caption ?? '' },
    token,
  });
  if (ok) return { edited: true };
  throw new ApiError(502, `Couldn't update the caption on Facebook: ${error?.message || 'unknown error'}`);
}

// One page of comment content for a published post, oldest first. NOTE: Facebook
// withholds the commenter's identity (`from`) for ordinary users — surface
// message + time only.
export async function listComments(platformPostId, { after = null, limit = 25 } = {}, token) {
  const fields = { fields: 'message,created_time', order: 'chronological', limit: String(limit) };
  if (after) fields.after = after;
  const { ok, error, data } = await graph(`${platformPostId}/comments`, { fields, token });
  if (!ok) throw new ApiError(502, `Couldn't load comments from Facebook: ${error?.message || 'unknown error'}`);
  return {
    comments: (data.data || []).map((c) => ({ id: c.id, message: c.message || '', created_time: c.created_time })),
    nextCursor: data.paging?.next ? data.paging.cursors?.after ?? null : null,
  };
}

// Resolve a published post's {page}_{post} feed id from its stored platform id.
// Best-effort: returns null if not found yet (caller retries).
export async function resolveParentPostId(platformPostId, { token, fbPageId } = {}) {
  if (!platformPostId) return null;
  if (String(platformPostId).includes('_')) return platformPostId; // already a {page}_{post}
  const pageId = fbPageId || env.facebook.pageId;
  if (!pageId) return null;
  try {
    const { ok, data } = await graph(`${pageId}/published_posts`, {
      fields: { fields: 'id,attachments.limit(1){target{id}}', limit: '25' },
      token,
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

// Read engagement for a set of published posts (all from the SAME page) in ONE
// Graph batch (≤50 sub-requests). Best-effort: a failed sub-request is skipped.
export async function fetchEngagementBatch(posts = [], token) {
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

  const results = await graphBatch(ops, token);
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

// Daily page-level insight time-series from the Graph Insights API.
export async function fetchPageInsights(metrics = [], since, until, { token, fbPageId } = {}) {
  const pageId = fbPageId || env.facebook.pageId;
  if (!pageId) throw new ApiError(503, 'Facebook page is not configured');
  const fields = { metric: metrics.join(','), period: 'day' };
  if (since) fields.since = String(since);
  if (until) fields.until = String(until);
  const { ok, error, data } = await graph(`${pageId}/insights`, { fields, token });
  if (!ok) throw new ApiError(502, `Couldn't read page insights: ${error?.message || 'unknown error'}`);
  const out = {};
  for (const m of data.data || []) {
    out[m.name] = (m.values || []).map((v) => ({
      date: String(v.end_time || '').slice(0, 10),
      value: typeof v.value === 'number' ? v.value : 0,
    }));
  }
  return out;
}

// Current follower/fan count + name from the Page object. null on error.
export async function fetchPageProfile({ token, fbPageId } = {}) {
  const pageId = fbPageId || env.facebook.pageId;
  if (!pageId) return null;
  const { ok, data } = await graph(pageId, { fields: { fields: 'name,fan_count,followers_count' }, token });
  if (!ok) return null;
  return { name: data.name ?? null, fans: data.fan_count ?? null, followers: data.followers_count ?? null };
}

// Validate a page access token: read the object it belongs to (/me) and confirm
// it matches the given page id. Catches the common mistakes — expired/invalid
// token, or a USER token pasted instead of a PAGE token. Returns
// { ok, name, followers } or { ok:false, error }.
export async function verifyPageToken({ token, fbPageId } = {}) {
  if (!token) return { ok: false, error: 'A page access token is required.' };
  const { ok, error, data } = await graph('me', {
    fields: { fields: 'id,name,followers_count,fan_count' },
    token,
  });
  if (!ok) return { ok: false, error: error?.message || 'The access token was rejected by Facebook.' };
  if (fbPageId && String(data.id) !== String(fbPageId)) {
    return {
      ok: false,
      error: `This token belongs to "${data.name || data.id}" (id ${data.id}), not Page ID ${fbPageId}.`,
    };
  }
  return { ok: true, name: data.name ?? null, followers: data.followers_count ?? data.fan_count ?? null };
}
