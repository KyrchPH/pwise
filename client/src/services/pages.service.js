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

// Per-page Facebook connection health — [{ id, ok, reason }]. Checked on app start
// so a page whose token was revoked/expired can be flagged and its tools disabled
// until reconnected. reason: 'ok' | 'no_token' | 'invalid_token' | 'unknown'.
export async function health() {
  const { data } = await api.get('/pages/health');
  return data.data.health;
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

// The page's per-agent AI prompts (+ built-in defaults) for the settings editor.
// Admin-only on the server. Returns { prompts: { sales, support, general }, defaults }.
export async function getAiConfig(id) {
  const { data } = await api.get(`/pages/${id}/ai-config`);
  return data.data;
}

// The built-in default agent prompts — pre-fills the connect/new-page editor.
export async function getAiDefaults() {
  const { data } = await api.get('/pages/ai-defaults');
  return data.data.defaults; // { sales, support, general }
}

export async function remove(id) {
  const { data } = await api.delete(`/pages/${id}`);
  return data.data;
}

// ── Connect with Facebook (OAuth import) ─────────────────────────────────────
// Start the flow: returns the Facebook dialog URL to send the browser to
// (window.location.href = url). Admin-only on the server.
export async function facebookOAuthUrl() {
  const { data } = await api.post('/pages/facebook/oauth-url');
  return data.data.url;
}

// After the OAuth round-trip, the staged pages for the import picker.
// Returns { expired, pages: [{ fb_page_id, name, alreadyConnected }] }.
export async function facebookDiscovered(batch) {
  const { data } = await api.get('/pages/facebook/discovered', { params: { batch } });
  return data.data;
}

// Import the chosen pages from a discovery batch. Returns per-page results
// [{ id, name, fb_page_id, status: 'connected'|'reconnected'|'failed' }].
export async function facebookImport(batch, fbPageIds) {
  const { data } = await api.post('/pages/facebook/import', { batch, fb_page_ids: fbPageIds });
  return data.data.results;
}

// Re-register this page's Telegram webhook (and Messenger subscription) with the
// platform — the Settings "Refresh" action. Returns { telegram, messenger } where
// each is { ok, ... } | null (null = nothing of that kind attached to the page).
export async function refreshWebhook(id) {
  const { data } = await api.post(`/pages/${id}/refresh-webhook`);
  return data.data;
}
