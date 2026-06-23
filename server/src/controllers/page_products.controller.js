import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as products from '../services/page_products.service.js';

// Per-page product catalog (Workspace → Products, and the chat composer's Products
// drawer). All routes are JWT-authed; products are shared per page like the rest of
// the app's data.
export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, { products: await products.list(req.query.accountId) });
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, { product: await products.create(req.user, req.body || {}) }, 201);
});

export const update = asyncHandler(async (req, res) => {
  sendSuccess(res, { product: await products.update(req.params.id, req.user, req.body || {}) });
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await products.remove(req.params.id));
});
