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

// Switch the current user's active page.
export const select = asyncHandler(async (req, res) => {
  const { account_id } = req.body || {};
  if (account_id != null) await pages.getById(account_id); // 404 if it doesn't exist
  const selected = await settings.setSelectedAccount(req.user.id, account_id ?? null);
  sendSuccess(res, { selected_account_id: selected });
});

// Admin-only writes.
export const create = asyncHandler(async (req, res) => {
  const page = await pages.create(req.user, req.body || {});
  sendSuccess(res, { page }, 201);
});

export const update = asyncHandler(async (req, res) => {
  sendSuccess(res, { page: await pages.update(req.params.id, req.body || {}) });
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await pages.remove(req.params.id));
});
