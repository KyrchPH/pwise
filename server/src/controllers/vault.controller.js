import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/vault.service.js';

// Shared vault: reads aren't user-scoped (everyone sees every item). Writes pass
// the acting user (req.user) so the uploader is recorded.
export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, { items: await service.listAll() });
});

export const createFolder = asyncHandler(async (req, res) => {
  const item = await service.createFolder(req.user, req.body || {});
  sendSuccess(res, { item }, 201);
});

// Persist a file whose bytes were already uploaded to S3 via a presigned URL.
export const createFile = asyncHandler(async (req, res) => {
  const item = await service.createFile(req.user, req.body || {});
  sendSuccess(res, { item }, 201);
});

// Move a file/folder under a new parent folder (parentId null → root).
export const move = asyncHandler(async (req, res) => {
  const item = await service.move(req.params.id, (req.body || {}).parentId ?? null);
  sendSuccess(res, { item });
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.remove(req.params.id));
});

// Toggle whether a file is hidden from the AI agent's media search. Body: { aiHidden }.
export const setAiVisibility = asyncHandler(async (req, res) => {
  const item = await service.setAiHidden(req.params.id, !!(req.body || {}).aiHidden);
  sendSuccess(res, { item });
});
