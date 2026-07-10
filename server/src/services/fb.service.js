import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

// Every call targets a specific connected page via its (decrypted) access token.
// `token` falls back to the legacy env token so posts not yet tagged with a page
// (or page-level calls before a page is selected) keep working during rollout.
// fbPageId likewise falls back to env.facebook.pageId.

// The caption lives in a different Graph field per media type.
function captionField(mediaType) {
  if (mediaType === 'video') return 'description'; // videos / reels (verified editable)
  // Photo posts AND text/link posts edit via the story's `message`. (A photo's `caption`
  // field is NOT editable on the feed-story id — Facebook rejects it — even though the
  // photo's on-post text lives there; `message` is what actually updates. Verified live
  // via Graph API Explorer against a page photo post.)
  return 'message';
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

// Facebook refuses caption/message edits on posts past its edit window (or that were
// never editable). The exact wording has drifted across Graph versions, so match the
// family of phrasings rather than a single code — anything unmatched still surfaces the
// raw Graph message, so a miss is visible (and easy to add here).
const EDIT_CLOSED_RE = /too old|too long ago|no longer be edited|can(?:no|'?)t be edited|not (?:allowed|eligible|permitted) to edit/i;
export function isEditWindowClosedError(messageOrError) {
  const msg = typeof messageOrError === 'string' ? messageOrError : messageOrError?.message || '';
  return EDIT_CLOSED_RE.test(msg);
}

// Every Graph call is bounded by a client-side timeout. Without one, a slow or hung
// Facebook endpoint keeps the Express request pending until nginx's upstream timeout,
// which returns a 502 the browser reports (misleadingly) as a CORS error. Aborting at
// GRAPH_TIMEOUT_MS (well under nginx's default 60s) turns that into a fast, catchable
// error the client can actually read.
const GRAPH_TIMEOUT_MS = 20000;
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ApiError(504, `Facebook didn't respond within ${GRAPH_TIMEOUT_MS / 1000}s — please try again.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Thin Graph API call against a single object id. The access token rides in the
// query string for GET/DELETE and in the form body for POST.
async function graph(id, { method = 'GET', fields = {}, token } = {}) {
  const params = new URLSearchParams({ ...fields, access_token: tokenOrThrow(token) });
  const url = `https://graph.facebook.com/${env.facebook.graphVersion}/${id}`;
  let res;
  try {
    res = method === 'POST'
      ? await fetchWithTimeout(url, { method, body: params })
      : await fetchWithTimeout(`${url}?${params.toString()}`, { method });
  } catch (err) {
    if (err instanceof ApiError) throw err; // already a clean timeout (504)
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
    res = await fetchWithTimeout(`https://graph.facebook.com/${env.facebook.graphVersion}/`, { method: 'POST', body });
  } catch (err) {
    if (err instanceof ApiError) throw err; // already a clean timeout (504)
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
  // TEMP DIAGNOSTIC — logs exactly what we sent (object id + field for this media type)
  // and the raw Facebook error (code/subcode/message) for any edit that still fails.
  console.log(
    `[fb.editCaption] postId=${platformPostId} mediaType=${mediaType} field=${captionField(mediaType)} error=${JSON.stringify(error)}`,
  );
  if (isEditWindowClosedError(error)) {
    throw new ApiError(422, 'This post is too old to edit on Facebook — its caption can no longer be changed.');
  }
  if (isObjectGoneError(error)) {
    throw new ApiError(422, "Facebook won't let this app edit that post — it may have been removed on Facebook, or this page's connection lacks permission to edit it.");
  }
  // 422, NOT 502: this is a Facebook-side rejection the user needs to SEE. The reverse
  // proxy (nginx/Cloudflare) intercepts 5xx responses and strips their body + CORS
  // headers — which is exactly what masked this as a generic "CORS / Network Error". A
  // 4xx passes through untouched, so the real reason reaches the browser.
  throw new ApiError(422, `Couldn't update the caption on Facebook: ${error?.message || 'unknown error'}`);
}

// One page of comment content for a published post, oldest first. NOTE: Facebook
// withholds the commenter's identity (`from`) for ordinary users — surface
// message + time only.
export async function listComments(platformPostId, { after = null, limit = 25 } = {}, token) {
  // `from{name,id}` is best-effort: on a Page's OWN posts Facebook often returns the
  // commenter's name/id, but it's withheld for some users/privacy settings — callers
  // fall back to "Facebook user" when authorName is null.
  const fields = { fields: 'from{name,id},message,created_time', order: 'chronological', limit: String(limit) };
  if (after) fields.after = after;
  const { ok, error, data } = await graph(`${platformPostId}/comments`, { fields, token });
  if (!ok) throw new ApiError(502, `Couldn't load comments from Facebook: ${error?.message || 'unknown error'}`);
  return {
    comments: (data.data || []).map((c) => ({
      id: c.id,
      message: c.message || '',
      created_time: c.created_time,
      authorName: c.from?.name || null,
      authorId: c.from?.id || null,
    })),
    nextCursor: data.paging?.next ? data.paging.cursors?.after ?? null : null,
  };
}

// Reply to a comment AS THE PAGE — posts a reply under the given comment. `commentId`
// is a comment's own id (from listComments); replies attach directly to it, so there's
// no photo/feed id-shape concern here. Returns the new reply's id. Requires the
// `pages_manage_engagement` permission on the page token. Throws 422 (not 5xx) on a
// Facebook rejection so the real reason reaches the browser — a masked 5xx would show
// up as a bogus CORS error (see the CORS/502 note).
export async function replyToComment(commentId, message, token) {
  if (!commentId) throw new ApiError(400, 'a comment id is required');
  const { ok, error, data } = await graph(`${commentId}/comments`, {
    method: 'POST',
    fields: { message: String(message ?? '') },
    token,
  });
  if (ok) return { id: data.id || null };
  if (isObjectGoneError(error)) {
    throw new ApiError(422, "Facebook won't let this app reply to that comment — it may have been deleted, or this page's connection lacks permission (pages_manage_engagement).");
  }
  throw new ApiError(422, `Couldn't post the reply on Facebook: ${error?.message || 'unknown error'}`);
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
      // Watch-time insights on the video object (needs read_insights). Lifetime
      // metrics come back in MILLISECONDS; we convert to seconds when parsing.
      subs.push({ postId: p.id, kind: 'video_insights' });
      ops.push({
        method: 'GET',
        relative_url: `${p.platform_post_id}/video_insights?metric=total_video_view_time,total_video_avg_time_watched`,
      });
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
    } else if (sub.kind === 'video_insights' && Array.isArray(payload.data)) {
      // Each entry: { name, values: [{ value }] } — value is in milliseconds.
      const ms = (name) => {
        const m = payload.data.find((d) => d.name === name);
        const v = m?.values?.[0]?.value;
        return v == null ? null : Number(v);
      };
      const total = ms('total_video_view_time');
      const avg = ms('total_video_avg_time_watched');
      if (total != null) b.watchTime = Math.round(total / 1000);
      if (avg != null) b.avgWatch = Math.round(avg / 1000);
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
  const push = (key, date, value) => {
    (out[key] ||= []).push({ date, value: Number(value) || 0 });
  };
  for (const m of data.data || []) {
    for (const v of m.values || []) {
      const date = String(v.end_time || '').slice(0, 10);
      const val = v.value;
      if (val != null && typeof val === 'object') {
        // Breakdown metric (e.g. page_impressions_by_follow_type → { follower, non_follower }).
        // Flatten each numeric key into its own "name:key" sub-metric so it can be warehoused
        // and charted like a plain metric.
        for (const [k, num] of Object.entries(val)) {
          if (typeof num === 'number') push(`${m.name}:${k}`, date, num);
        }
      } else {
        push(m.name, date, typeof val === 'number' ? val : 0);
      }
    }
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

// ── Messenger Send API ────────────────────────────────────────────────────────
// Deliver a Page → customer message. `recipientId` is the customer's PSID
// (stored as the conversation's customer_handle); `token` is the page access token.
// Best-effort — returns { ok, messageId } / { ok:false, error }; never throws.
export async function sendMessage(token, recipientId, text) {
  if (!token || !recipientId) return { ok: false, error: 'missing token or recipient' };
  try {
    const { ok, error, data } = await graph('me/messages', {
      method: 'POST',
      token,
      fields: {
        messaging_type: 'RESPONSE',
        recipient: JSON.stringify({ id: String(recipientId) }),
        message: JSON.stringify({ text: String(text ?? '') }),
      },
    });
    if (!ok) return { ok: false, error: error?.message || 'Messenger send failed' };
    return { ok: true, messageId: data.message_id ?? null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Private Reply: send the FIRST message to a person who commented, addressing them by
// their COMMENT id (Facebook doesn't expose the commenter's PSID otherwise). Facebook
// allows this once per comment, within 7 days. The response's `recipient_id` IS the
// customer's PSID — the caller uses it to create/track the conversation from then on.
// Returns { ok, recipientId, messageId } or { ok:false, error }.
export async function privateReplyToComment(token, commentId, text) {
  if (!token || !commentId) return { ok: false, error: 'missing token or comment id' };
  try {
    const { ok, error, data } = await graph('me/messages', {
      method: 'POST',
      token,
      fields: {
        recipient: JSON.stringify({ comment_id: String(commentId) }),
        message: JSON.stringify({ text: String(text ?? '') }),
      },
    });
    if (!ok) return { ok: false, error: error?.message || 'Private reply failed' };
    return { ok: true, recipientId: data.recipient_id ?? null, messageId: data.message_id ?? null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Deliver media by URL — image/video/audio attachment, else a generic file. The URL
// must be publicly reachable (our presigned S3 URLs are).
export async function sendMedia(token, recipientId, { url, type } = {}) {
  if (!token || !recipientId || !url) return { ok: false, error: 'missing token, recipient, or url' };
  const t = String(type || '').toLowerCase();
  const attType = t.startsWith('image') ? 'image' : t.startsWith('video') ? 'video' : t.startsWith('audio') ? 'audio' : 'file';
  try {
    const { ok, error, data } = await graph('me/messages', {
      method: 'POST',
      token,
      fields: {
        messaging_type: 'RESPONSE',
        recipient: JSON.stringify({ id: String(recipientId) }),
        message: JSON.stringify({ attachment: { type: attType, payload: { url: String(url), is_reusable: false } } }),
      },
    });
    if (!ok) return { ok: false, error: error?.message || 'Messenger media send failed' };
    return { ok: true, messageId: data.message_id ?? null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Resolve a customer's display name + profile photo from their PSID (Messenger User
// Profile API). Best-effort — returns { name, avatar } or null. NOTE: the photo field
// for a page-scoped PSID is `profile_pic` (a plain URL string), NOT the Graph
// user-object `picture` field — requesting an invalid field errors the WHOLE call
// (graph() flags any data.error as !ok), which would silently drop the name too. So
// we ask for name+profile_pic, but fall back to a name-only call if that ever fails,
// so an avatar hiccup can never cost us the display name. The profile_pic URL is a
// short-lived Meta CDN link, so callers should refresh it on each inbound message.
export async function getUserProfile(token, psid) {
  if (!token || !psid) return null;
  let meta = null; // TEMP DIAGNOSTIC: raw Meta result of the last attempt, surfaced to callers
  const fetchFields = async (fieldStr) => {
    const { ok, error, data } = await graph(String(psid), { fields: { fields: fieldStr }, token });
    meta = { fields: fieldStr, ok, error, data };
    return ok ? data : null;
  };
  try {
    const data = (await fetchFields('name,profile_pic')) || (await fetchFields('name'));
    const name = data ? data.name || null : null;
    const avatar = data && data.profile_pic ? String(data.profile_pic) : null;
    return { name, avatar, meta };
  } catch (e) {
    return { name: null, avatar: null, meta: { error: String(e?.message || e) } };
  }
}

// ── Stories (Facebook Page Stories + Instagram Stories) ─────────────────────
// Stories are published straight from the API server (no n8n): they carry no
// caption, so there's nothing for the generate branch to do, and the multi-step
// upload flows below don't map onto the single publish webhook. All media URLs
// must be publicly reachable (our presigned S3 URLs are). Every helper throws an
// ApiError whose message is safe to store as the story's failed_reason.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A Graph error message worth showing the user (e.g. a missing permission or an
// unsupported media format), never a bare "unknown error" wall.
const graphMsg = (error, fallback) => error?.message || fallback;

// Publish a photo story on a Facebook Page: upload the photo UNPUBLISHED first,
// then create the story from the photo id. Returns { storyId } (the story post id).
export async function publishPhotoStory({ photoUrl, token, fbPageId } = {}) {
  const pageId = fbPageId || env.facebook.pageId;
  if (!pageId) throw new ApiError(503, 'Facebook page is not configured');
  const up = await graph(`${pageId}/photos`, {
    method: 'POST',
    fields: { url: String(photoUrl), published: 'false' },
    token,
  });
  if (!up.ok || !up.data.id) {
    throw new ApiError(422, `Facebook rejected the photo upload: ${graphMsg(up.error, 'no photo id returned')}`);
  }
  const story = await graph(`${pageId}/photo_stories`, {
    method: 'POST',
    fields: { photo_id: String(up.data.id) },
    token,
  });
  if (!story.ok || !story.data.post_id) {
    throw new ApiError(422, `Facebook rejected the photo story: ${graphMsg(story.error, 'no story id returned')}`);
  }
  return { storyId: String(story.data.post_id) };
}

// Publish a video story on a Facebook Page — three phases: start an upload
// session, hand Meta the hosted file URL (it downloads server-side), finish.
// After finish the video still processes asynchronously, so poll its status
// until it's ready (an early 'error' fails fast with Meta's reason).
export async function publishVideoStory({ videoUrl, token, fbPageId } = {}) {
  const pageId = fbPageId || env.facebook.pageId;
  if (!pageId) throw new ApiError(503, 'Facebook page is not configured');

  const start = await graph(`${pageId}/video_stories`, {
    method: 'POST',
    fields: { upload_phase: 'start' },
    token,
  });
  if (!start.ok || !start.data.video_id || !start.data.upload_url) {
    throw new ApiError(422, `Facebook couldn't start the story upload: ${graphMsg(start.error, 'no upload session returned')}`);
  }
  const { video_id: videoId, upload_url: uploadUrl } = start.data;

  // Hosted-file upload: Meta pulls the video from `file_url` itself. This call can
  // take a while for larger clips, so it gets its own (generous) timeout instead of
  // the 20s graph() one.
  let uploadRes;
  try {
    uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `OAuth ${tokenOrThrow(token)}`, file_url: String(videoUrl) },
      signal: AbortSignal.timeout(120 * 1000),
    });
  } catch (err) {
    throw new ApiError(422, `Uploading the story video to Facebook failed: ${err.message}`);
  }
  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok || uploadData.error || uploadData.success === false) {
    throw new ApiError(422, `Facebook rejected the story video upload: ${graphMsg(uploadData.error, `HTTP ${uploadRes.status}`)}`);
  }

  const finish = await graph(`${pageId}/video_stories`, {
    method: 'POST',
    fields: { upload_phase: 'finish', video_id: String(videoId) },
    token,
  });
  if (!finish.ok || finish.data.success === false) {
    throw new ApiError(422, `Facebook couldn't publish the video story: ${graphMsg(finish.error, 'finish phase failed')}`);
  }
  const storyId = finish.data.post_id ? String(finish.data.post_id) : String(videoId);

  // Processing poll — bounded. 'error' fails with Meta's reason; still-processing
  // after the window is treated as posted (finish already succeeded, and Meta
  // almost always completes shortly after).
  for (let i = 0; i < 12; i += 1) {
    const st = await graph(String(videoId), { fields: { fields: 'status' }, token });
    const videoStatus = st.ok ? st.data.status?.video_status : null;
    if (videoStatus === 'error') {
      const detail = st.data.status?.processing_phase?.errors?.[0]?.message;
      throw new ApiError(422, `Facebook couldn't process the story video${detail ? `: ${detail}` : ''}`);
    }
    if (videoStatus === 'ready' || videoStatus === 'published' || videoStatus == null) break;
    await sleep(5000);
  }
  return { storyId };
}

// Publish an Instagram story on the page's linked professional account: create a
// STORIES media container, wait for it to finish processing, then publish it.
// Uses the page access token (same as IG messaging); needs the
// instagram_content_publish permission. Returns { storyId } (the IG media id).
export async function publishInstagramStory({ igUserId, mediaType, mediaUrl, token } = {}) {
  if (!igUserId) throw new ApiError(422, 'This page has no linked Instagram account');
  const container = await graph(`${igUserId}/media`, {
    method: 'POST',
    fields: {
      media_type: 'STORIES',
      [mediaType === 'video' ? 'video_url' : 'image_url']: String(mediaUrl),
    },
    token,
  });
  if (!container.ok || !container.data.id) {
    throw new ApiError(422, `Instagram rejected the story media: ${graphMsg(container.error, 'no container id returned')}`);
  }
  const creationId = String(container.data.id);

  // Container processing poll — images are usually instant, videos take a while.
  let ready = false;
  for (let i = 0; i < 24; i += 1) {
    const st = await graph(creationId, { fields: { fields: 'status_code' }, token });
    const code = st.ok ? st.data.status_code : null;
    if (code === 'FINISHED') {
      ready = true;
      break;
    }
    if (code === 'ERROR' || code === 'EXPIRED') {
      throw new ApiError(422, 'Instagram couldn\'t process the story media — check the format (JPEG images; MP4/MOV video up to 60s).');
    }
    await sleep(5000);
  }
  if (!ready) throw new ApiError(422, 'Instagram is still processing the story media — it never became ready to publish.');

  const publish = await graph(`${igUserId}/media_publish`, {
    method: 'POST',
    fields: { creation_id: creationId },
    token,
  });
  if (!publish.ok || !publish.data.id) {
    throw new ApiError(422, `Instagram couldn't publish the story: ${graphMsg(publish.error, 'no media id returned')}`);
  }
  return { storyId: String(publish.data.id) };
}

// Best-effort delete of a published story by its platform id. Facebook story
// posts delete like any post; Instagram doesn't support deleting stories via
// the API — treat "unsupported" the same as already-gone (the story expires on
// its own within 24h anyway). Never throws.
export async function deleteStory(platformStoryId, token) {
  if (!platformStoryId) return { deleted: true };
  try {
    const { ok, error } = await graph(String(platformStoryId), { method: 'DELETE', token });
    if (ok || isObjectGoneError(error?.message || '')) return { deleted: true };
    return { deleted: false, error: error?.message || 'unknown error' };
  } catch (e) {
    return { deleted: false, error: e.message };
  }
}

// Subscribe a Page to this app's webhooks for messaging, so its inbound messages
// reach our /api/webhooks/messenger endpoint. Best-effort.
export async function subscribeMessaging(token, pageId) {
  if (!token || !pageId) return { ok: false, error: 'missing token or page id' };
  try {
    const { ok, error } = await graph(`${pageId}/subscribed_apps`, {
      method: 'POST',
      token,
      fields: { subscribed_fields: 'messages,messaging_postbacks,feed' },
    });
    if (!ok) return { ok: false, error: error?.message || 'subscribe failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
