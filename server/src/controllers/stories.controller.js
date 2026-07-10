import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/stories.service.js';
import * as settings from '../services/settings.service.js';

// Stories are page-scoped like the post pool: every route resolves the caller's
// active page and works within it. Writes pass the acting user for the audit log.

export const list = asyncHandler(async (req, res) => {
  const accountId = await settings.getSelectedAccountId(req.user.id); // active page scope
  const { stories, total } = await service.list({
    accountId,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  sendSuccess(res, { stories, total });
});

export const getOne = asyncHandler(async (req, res) => {
  const accountId = await settings.getSelectedAccountId(req.user.id); // active page scope
  const story = await service.getOne(req.params.id, accountId);
  sendSuccess(res, { story });
});

export const insights = asyncHandler(async (req, res) => {
  const accountId = await settings.getSelectedAccountId(req.user.id);
  const data = await service.insights(req.params.id, accountId);
  sendSuccess(res, data);
});

export const create = asyncHandler(async (req, res) => {
  const accountId = await settings.getSelectedAccountId(req.user.id);
  const stories = await service.create(req.user, { ...(req.body || {}), accountId });
  sendSuccess(res, { stories }, 201);
});

export const retry = asyncHandler(async (req, res) => {
  const story = await service.retryNow(req.params.id, req.user);
  sendSuccess(res, { story });
});

export const remove = asyncHandler(async (req, res) => {
  const result = await service.remove(req.params.id, req.user);
  sendSuccess(res, result);
});
