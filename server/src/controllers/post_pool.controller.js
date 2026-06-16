import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/post_pool.service.js';
import * as settings from '../services/settings.service.js';

// Shared pool: reads are not user-scoped (everyone sees every post). Writes pass
// the acting user (req.user = { id, name, ... }) so the action is audit-logged.
export const list = asyncHandler(async (req, res) => {
  const { status, scheduled, limit, offset, refresh } = req.query;
  const accountId = await settings.getSelectedAccountId(req.user.id); // active page scope
  const { posts, total } = await service.list({ status, scheduled, accountId, limit, offset });
  // `refresh=1` re-reads engagement for this page's published posts from Facebook
  // (stale-only, best-effort) before responding — used by the Post Pool page load.
  if (refresh === '1' || refresh === 'true') await service.refreshEngagement(posts);
  sendSuccess(res, { posts, total });
});

export const create = asyncHandler(async (req, res) => {
  const post = await service.create(req.user, req.body || {});
  sendSuccess(res, { post }, 201);
});

export const get = asyncHandler(async (req, res) => {
  const post = await service.getById(req.params.id);
  sendSuccess(res, { post });
});

export const comments = asyncHandler(async (req, res) => {
  const result = await service.listComments(req.params.id, {
    after: req.query.after,
    limit: req.query.limit,
  });
  sendSuccess(res, result);
});

export const insights = asyncHandler(async (req, res) => {
  const result = await service.insights(req.params.id, {
    metric: req.query.metric,
    granularity: req.query.granularity,
  });
  sendSuccess(res, result);
});

export const update = asyncHandler(async (req, res) => {
  const post = await service.update(req.params.id, req.body || {}, req.user);
  sendSuccess(res, { post });
});

// Retry a failed/expired post immediately (re-publish via the n8n webhook, ignoring
// the schedule). Returns the post flipped to 'posting'.
export const retry = asyncHandler(async (req, res) => {
  const post = await service.retryNow(req.params.id, req.user);
  sendSuccess(res, { post });
});

export const remove = asyncHandler(async (req, res) => {
  const result = await service.remove(req.params.id, req.user);
  sendSuccess(res, result);
});

export const counts = asyncHandler(async (req, res) => {
  const accountId = await settings.getSelectedAccountId(req.user.id); // active page scope
  const counts = await service.counts(accountId);
  sendSuccess(res, { counts });
});

// Pre-flight check the client calls before uploading media to a scheduled slot.
export const checkSlot = asyncHandler(async (req, res) => {
  const available = await service.isSlotFree(req.query.scheduled_at, req.query.exclude_id);
  sendSuccess(res, { available });
});
