import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import ApiError from '../utils/ApiError.js';
import * as service from '../services/creatomate.service.js';

export const list = asyncHandler(async (req, res) => {
  const templates = await service.list();
  sendSuccess(res, { templates });
});

export const create = asyncHandler(async (req, res) => {
  const template = await service.create(req.user, req.body || {});
  sendSuccess(res, { template }, 201);
});

export const update = asyncHandler(async (req, res) => {
  const template = await service.update(req.params.id, req.body || {});
  sendSuccess(res, { template });
});

export const remove = asyncHandler(async (req, res) => {
  const result = await service.remove(req.params.id);
  sendSuccess(res, result);
});

// "Generate with Template": trigger the n8n render with the just-uploaded input
// video; responds with the rendered video URL n8n returns.
export const startRender = asyncHandler(async (req, res) => {
  const { template_id, video_s3_key, caption } = req.body || {};
  if (!template_id) throw ApiError.badRequest('template_id is required');
  const result = await service.startRender(template_id, {
    videoS3Key: video_s3_key || null,
    caption: caption || null,
  });
  sendSuccess(res, result); // { url }
});

// Download the rendered video into S3 (called at post-submit, after "Upload output").
export const saveRender = asyncHandler(async (req, res) => {
  const { url } = req.body || {};
  if (!url) throw ApiError.badRequest('url is required');
  sendSuccess(res, await service.ingestRenderToS3(url, req.user.id));
});
