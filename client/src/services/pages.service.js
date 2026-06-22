import api from './api.js';

// Connected Facebook pages (each may carry an optional attached Telegram bot).
// List/active/select are available to any signed-in user (for the switcher);
// create/update/remove are admin-only on the server.
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

// Re-sync every page's name/followers from Facebook. Returns per-page results
// [{ id, ok, name, followers }]; ok:false means the token failed (expired).
export async function refreshAll() {
  const { data } = await api.post('/pages/refresh');
  return data.data.results;
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

// Re-register this page's Telegram webhook (and Messenger subscription) with the
// platform — the Settings "Refresh" action. Returns { telegram, messenger } where
// each is { ok, ... } | null (null = nothing of that kind attached to the page).
export async function refreshWebhook(id) {
  const { data } = await api.post(`/pages/${id}/refresh-webhook`);
  return data.data;
}
