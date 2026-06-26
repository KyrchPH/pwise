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

// "Generate with Template": kick off the n8n → Creatomate render for the just-
// uploaded input video. Returns immediately with a render-job id to poll — the
// render finishes asynchronously and reports back via renderCallback.
export const startRender = asyncHandler(async (req, res) => {
  const { template_id, video_s3_key, image_s3_key, text, caption } = req.body || {};
  if (!template_id) throw ApiError.badRequest('template_id is required');
  const result = await service.startRender(req.user, template_id, {
    videoS3Key: video_s3_key || null,
    imageS3Key: image_s3_key || null,
    text: text || null,
    caption: caption || null,
  });
  sendSuccess(res, result, 202); // { renderJobId, status: 'rendering' }
});

// Poll a render job's state — the composer hits this until succeeded/failed.
export const renderStatus = asyncHandler(async (req, res) => {
  const job = await service.getRenderJob(req.params.id, req.user);
  sendSuccess(res, job); // { renderJobId, status, url, snapshotUrl, errorMessage }
});

// Machine-only (service token): the n8n render-complete webhook reports the result.
export const renderCallback = asyncHandler(async (req, res) => {
  const { render_job_id, status, video_url, snapshot_url, error_message } = req.body || {};
  const result = await service.recordRenderResult(render_job_id, {
    status,
    videoUrl: video_url || null,
    snapshotUrl: snapshot_url || null,
    errorMessage: error_message || null,
  });
  sendSuccess(res, result);
});

// Download the rendered video into S3 (called at post-submit, after "Upload output").
export const saveRender = asyncHandler(async (req, res) => {
  const { url } = req.body || {};
  if (!url) throw ApiError.badRequest('url is required');
  sendSuccess(res, await service.ingestRenderToS3(url, req.user.id));
});
