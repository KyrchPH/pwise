import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as discounts from '../services/page_discounts.service.js';

// Per-page discount rules (Shop → Discounts). All routes are JWT-authed; discounts are
// shared per page like the rest of the app's data. Writes are admin-only (see routes).
export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, { discounts: await discounts.list(req.query.accountId) });
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, { discount: await discounts.create(req.user, req.body || {}) }, 201);
});

export const update = asyncHandler(async (req, res) => {
  sendSuccess(res, { discount: await discounts.update(req.params.id, req.user, req.body || {}) });
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await discounts.remove(req.params.id));
});
