import api from './api.js';

// Returns { posts, total }. Pass { refresh: 1 } to have the server re-read this
// page's engagement from Facebook (stale-only) before responding.
export async function list(params = {}) {
  const { data } = await api.get('/post-pool', { params });
  return data.data; // { posts, total }
}

// Pass { refresh: true } to force a live engagement re-read (bypassing the server's
// TTL) before responding — used by the post viewer so its counts match live comments.
export async function get(id, { refresh } = {}) {
  const { data } = await api.get(`/post-pool/${id}`, { params: refresh ? { refresh: 1 } : {} });
  return data.data.post;
}

export async function create(payload) {
  const { data } = await api.post('/post-pool', payload);
  return data.data.post;
}

export async function update(id, payload) {
  const { data } = await api.patch(`/post-pool/${id}`, payload);
  return data.data.post;
}

// Re-publish a failed/expired post immediately via the n8n webhook — ignores the
// schedule, so it works even when the post's time already passed. Returns the post
// (now 'posting'; n8n reports the final result back asynchronously).
export async function retry(id) {
  const { data } = await api.post(`/post-pool/${id}/retry`);
  return data.data.post;
}

export async function remove(id) {
  const { data } = await api.delete(`/post-pool/${id}`);
  return data.data;
}

export async function counts() {
  const { data } = await api.get('/post-pool/counts');
  return data.data.counts;
}

// Pre-flight: is the given scheduled slot free? Call before uploading media.
export async function slotAvailable(scheduledAt, excludeId) {
  const { data } = await api.get('/post-pool/slot', {
    params: { scheduled_at: scheduledAt, ...(excludeId != null ? { exclude_id: excludeId } : {}) },
  });
  return data.data.available;
}

// A page of live Facebook comments for a published post. `after` is the paging
// cursor (omit for the first page). Returns { comments, nextCursor }.
export async function comments(id, after) {
  const { data } = await api.get(`/post-pool/${id}/comments`, { params: after ? { after } : {} });
  return data.data;
}

// Reply to a Facebook comment as the Page (from the post view). Returns { id }.
export async function replyToComment(id, commentId, message) {
  const { data } = await api.post(`/post-pool/${id}/comments/${commentId}/reply`, { message });
  return data.data;
}

// Comments inbox: a flat, newest-first feed of live Facebook comments across the active
// page's posts. filter: 'all' | 'open' | 'done'. Returns { comments, posts, truncated,
// scannedPosts } — each comment carries a postId that keys into the posts map.
export async function commentFeed({ filter = 'all' } = {}) {
  const { data } = await api.get('/post-pool/comments/feed', { params: filter && filter !== 'all' ? { filter } : {} });
  return data.data;
}

// Mark a comment handled ('done') or reopen it ('open') — shared across the team on the
// active page. Returns { commentId, status, handled }.
export async function setCommentStatus(commentId, { postId, status = 'done' } = {}) {
  const { data } = await api.post(`/post-pool/comments/${commentId}/status`, { postId, status });
  return data.data;
}

// Message the person who left a comment via a Messenger private reply, opening the
// conversation. Returns { conversationId, created }.
export async function messageCommenter(id, commentId, message) {
  const { data } = await api.post(`/post-pool/${id}/comments/${commentId}/message`, { message });
  return data.data;
}

// Engagement time-series for one metric of a post. metric: reactions|comments|
// shares|views. granularity: 'day' | 'month'. Returns { metric, granularity, points }.
export async function insights(id, metric, granularity) {
  const { data } = await api.get(`/post-pool/${id}/insights`, { params: { metric, granularity } });
  return data.data;
}
