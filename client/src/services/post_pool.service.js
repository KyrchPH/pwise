import api from './api.js';

// Returns { posts, total }. Pass { refresh: 1 } to have the server re-read this
// page's engagement from Facebook (stale-only) before responding.
export async function list(params = {}) {
  const { data } = await api.get('/post-pool', { params });
  return data.data; // { posts, total }
}

export async function get(id) {
  const { data } = await api.get(`/post-pool/${id}`);
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
