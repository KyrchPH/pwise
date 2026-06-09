import api from './api.js';

// Connected Facebook pages. List/active/select are available to any signed-in
// user (for the switcher); create/update/remove are admin-only on the server.
export async function list() {
  const { data } = await api.get('/pages');
  return data.data.pages; // safe fields only (no secrets)
}

export async function active() {
  const { data } = await api.get('/pages/active');
  return data.data; // { selected_account_id, page }
}

// Live follower count (+ name) for a page — used by the sidebar active-page widget.
export async function stats(id) {
  const { data } = await api.get(`/pages/${id}/stats`);
  return data.data.stats; // { followers, name } | null
}

export async function select(accountId) {
  const { data } = await api.post('/pages/select', { account_id: accountId });
  return data.data;
}

// Validate credentials against Facebook before saving (the "Connect" step).
export async function test(payload) {
  const { data } = await api.post('/pages/test', payload);
  return data.data; // { ok, name, followers }
}

export async function create(payload) {
  const { data } = await api.post('/pages', payload);
  return data.data.page;
}

export async function update(id, payload) {
  const { data } = await api.patch(`/pages/${id}`, payload);
  return data.data.page;
}

export async function remove(id) {
  const { data } = await api.delete(`/pages/${id}`);
  return data.data;
}
