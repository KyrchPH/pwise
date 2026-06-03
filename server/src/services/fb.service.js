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
