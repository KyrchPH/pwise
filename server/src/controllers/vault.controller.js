import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/vault.service.js';

// Vault reads are scoped to the acting user: private folders (and their contents) are
// filtered out for non-admins who aren't on the allow-list. Writes pass req.user so the
// uploader is recorded and access is enforced.
export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, { items: await service.listAll(req.user) });
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
  const item = await service.move(req.user, req.params.id, (req.body || {}).parentId ?? null);
  sendSuccess(res, { item });
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.remove(req.user, req.params.id));
});

// Toggle whether a file is hidden from the AI agent's media search. Body: { aiHidden }.
export const setAiVisibility = asyncHandler(async (req, res) => {
  const item = await service.setAiHidden(req.user, req.params.id, !!(req.body || {}).aiHidden);
  sendSuccess(res, { item });
});

// Read a folder's access config (visibility + allow-listed user ids). Admin-only.
export const getAccess = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getFolderAccess(req.params.id));
});

// Set a folder's access: { visibility: 'public'|'private', userIds: [...] }. Admin-only.
export const setAccess = asyncHandler(async (req, res) => {
  const item = await service.setFolderAccess(req.params.id, req.body || {});
  sendSuccess(res, { item });
});

// Edit a file's AI metadata — free-text description + curated tags. The agent
// matches a customer's words against these (tags weighted highest) when picking
// media. Body: { description, tags } — tags as an array or comma-separated string.
export const updateMeta = asyncHandler(async (req, res) => {
  const item = await service.updateMeta(req.user, req.params.id, req.body || {});
  sendSuccess(res, { item });
});
