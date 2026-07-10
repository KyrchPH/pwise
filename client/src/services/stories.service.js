import api from './api.js';

// Contents → Stories: 24-hour stories published to Facebook / Instagram. One
// record per destination platform; publishing is asynchronous (records come back
// as 'posting' and flip to posted/failed — the page re-polls while any are pending).

export async function list(params = {}) {
  const { data } = await api.get('/stories', { params });
  return data.data; // { stories, total }
}

// A single story (scoped to the active page) with presigned media previews —
// used by the story view page.
export async function get(id) {
  const { data } = await api.get(`/stories/${id}`);
  return data.data.story;
}

// Live per-story insights from Meta. Returns { platform, status, supported,
// metrics: [{ key, label, hint, value }], note }.
export async function insights(id) {
  const { data } = await api.get(`/stories/${id}/insights`);
  return data.data;
}

// payload: { s3_key, thumbnail_s3_key, media_type, platforms: ['facebook','instagram'] }
// Returns the created records (one per platform), already in 'posting'.
export async function create(payload) {
  const { data } = await api.post('/stories', payload);
  return data.data.stories;
}

// Re-run a failed story's publish flow. Returns the story flipped to 'posting'.
export async function retry(id) {
  const { data } = await api.post(`/stories/${id}/retry`);
  return data.data.story;
}

export async function remove(id) {
  const { data } = await api.delete(`/stories/${id}`);
  return data.data;
}
