import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/scheduler.service.js';
import * as postPool from '../services/post_pool.service.js';
import * as analytics from '../services/analytics.service.js';

// n8n: claim up to N due posts in one atomic batch. Returns
// { claimed, count, posts: [...] } so a single run can publish every post due
// for a slot. `limit` (body or query) is clamped server-side to 1..50.
export const claimBatch = asyncHandler(async (req, res) => {
  const userId = req.body?.user_id ?? req.query.user_id ?? null;
  const limit = req.body?.limit ?? req.query.limit ?? 10;
  const result = await service.claimNextBatch({ userId, limit });
  sendSuccess(res, result);
});

// n8n: finalize after a successful publish to Meta.
export const markPosted = asyncHandler(async (req, res) => {
  const post = await service.markPosted(req.params.id, {
    platformPostId: req.body?.platform_post_id,
    responseMessage: req.body?.response_message,
    targetPlatform: req.body?.target_platform,
  });
  sendSuccess(res, { post });
});

// n8n: finalize after a failed publish.
export const markFailed = asyncHandler(async (req, res) => {
  const post = await service.markFailed(req.params.id, { errorMessage: req.body?.error_message });
  sendSuccess(res, { post });
});

// n8n: read ready-count + low-pool alert decision per enabled user.
export const poolStatus = asyncHandler(async (req, res) => {
  const pool = await service.poolStatus();
  sendSuccess(res, { pool });
});

// n8n: record that a low-pool email was sent (starts the 24h cooldown).
export const alertSent = asyncHandler(async (req, res) => {
  const result = await service.markAlertSent(req.params.id);
  sendSuccess(res, result);
});

// n8n: record an hourly engagement snapshot for recently-published posts (for the
// Insights graph). Batched + scoped server-side; n8n just triggers this on a schedule.
export const insightsSnapshot = asyncHandler(async (req, res) => {
  const posts = await postPool.snapshotRecentInsights();
  const page = await analytics.refreshAllPages(7); // refresh page-level metrics for every page
  sendSuccess(res, { posts, page });
});
