import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as pages from '../services/platform_accounts.service.js';
import * as settings from '../services/settings.service.js';

// List connected pages (safe fields only) — any signed-in user (for the switcher).
export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, { pages: await pages.list() });
});

// The current user's active page.
export const active = asyncHandler(async (req, res) => {
  const id = await settings.getSelectedAccountId(req.user.id);
  let page = null;
  if (id != null) {
    try {
      page = await pages.getById(id);
    } catch {
      page = null; // selection points at a deleted page
    }
  }
  sendSuccess(res, { selected_account_id: page ? id : null, page });
});

// Live follower count (+ name) for a page — any signed-in user (sidebar widget).
export const stats = asyncHandler(async (req, res) => {
  sendSuccess(res, { stats: await pages.getStats(req.params.id) });
});

// Re-sync all pages' name/followers from Facebook (the switcher's refresh
// button). Corrects stale names and flags pages whose token failed.
export const refresh = asyncHandler(async (req, res) => {
  sendSuccess(res, { results: await pages.refreshAll() });
});

// Switch the current user's active page.
export const select = asyncHandler(async (req, res) => {
  const { account_id } = req.body || {};
  if (account_id != null) await pages.getById(account_id); // 404 if it doesn't exist
  const selected = await settings.setSelectedAccount(req.user.id, account_id ?? null);
  sendSuccess(res, { selected_account_id: selected });
});

// Admin-only writes.

// Test page credentials against Facebook before saving (the "Connect" step).
export const test = asyncHandler(async (req, res) => {
  sendSuccess(res, await pages.testConnection(req.body || {}));
});

export const create = asyncHandler(async (req, res) => {
  const page = await pages.create(req.user, req.body || {});
  sendSuccess(res, { page }, 201);
});

export const update = asyncHandler(async (req, res) => {
  sendSuccess(res, { page: await pages.update(req.params.id, req.body || {}) });
});

// The page's per-agent AI prompts (+ built-in defaults) for the settings editor.
export const aiConfig = asyncHandler(async (req, res) => {
  sendSuccess(res, await pages.getAiConfig(req.params.id));
});

// The built-in default agent prompts (for the connect/new-page editor, no id yet).
export const aiDefaults = asyncHandler(async (req, res) => {
  sendSuccess(res, { defaults: pages.aiDefaults() });
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await pages.remove(req.params.id));
});

// Re-register this page's inbound webhooks (Telegram setWebhook + Messenger sub) with
// the platforms, without re-saving credentials. Returns per-platform results.
export const refreshWebhook = asyncHandler(async (req, res) => {
  sendSuccess(res, await pages.refreshWebhook(req.params.id));
});
