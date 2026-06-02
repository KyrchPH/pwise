import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/scheduler.service.js';

// n8n: claim the next post to publish (atomic; returns a presigned media URL).
export const claim = asyncHandler(async (req, res) => {
  const userId = req.body?.user_id ?? req.query.user_id ?? null;
  const result = await service.claimNext({ userId });
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

// n8n: list published posts whose engagement should be refreshed from the platform.
export const engagementPending = asyncHandler(async (req, res) => {
  const posts = await service.pendingEngagement(req.query.limit);
  sendSuccess(res, { posts });
});

// n8n: store engagement counts (reactions/comments/shares/views) for a post.
export const saveEngagement = asyncHandler(async (req, res) => {
  const post = await service.saveEngagement(req.params.id, {
    reactions: req.body?.reactions,
    comments: req.body?.comments,
    shares: req.body?.shares,
    views: req.body?.views,
  });
  sendSuccess(res, { post });
});
