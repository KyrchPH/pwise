import crypto from 'node:crypto';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import ApiError from '../utils/ApiError.js';
import * as s3 from '../services/s3.service.js';

const ALLOWED_PREFIXES = ['image/', 'video/'];

// Step 1: client asks for a presigned PUT URL, then uploads bytes straight to S3.
// `temporary` uploads (e.g. a template's input video) land under tmp/ so an S3
// lifecycle rule can auto-expire any that aren't cleaned up explicitly. `vault`
// uploads are the file manager — they accept ANY file type (not just media) and
// land under vault/.
export const presignedUrl = asyncHandler(async (req, res) => {
  const { filename, contentType, temporary, vault, avatar } = req.body || {};
  if (!filename || !contentType) throw ApiError.badRequest('filename and contentType are required');
  if (avatar && !String(contentType).startsWith('image/')) {
    throw ApiError.badRequest('only image uploads are allowed for profile photos');
  }
  // Posts are restricted to image/video; the vault stores arbitrary files.
  if (!vault && !ALLOWED_PREFIXES.some((p) => String(contentType).startsWith(p))) {
    throw ApiError.badRequest('only image/* or video/* uploads are allowed');
  }
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const base = avatar ? 'avatars' : vault ? 'vault' : temporary ? 'tmp' : 'uploads';
  const s3Key = `${base}/${req.user.id}/${crypto.randomUUID()}-${safeName}`;
  const uploadUrl = await s3.createUploadUrl(s3Key, contentType);
  sendSuccess(res, { uploadUrl, s3Key, mediaUrl: s3.publicObjectUrl(s3Key) });
});

// Delete a temporary upload (e.g. when the user drops a generated result before
// creating a post). Scoped to the caller's own tmp/ prefix so it can't be used
// to delete arbitrary objects.
export const discard = asyncHandler(async (req, res) => {
  const { s3Key } = req.body || {};
  if (!s3Key) throw ApiError.badRequest('s3Key is required');
  if (!String(s3Key).startsWith(`tmp/${req.user.id}/`)) {
    throw ApiError.badRequest('can only discard your own temporary uploads');
  }
  await s3.deleteObject(s3Key); // best-effort; never throws
  sendSuccess(res, { s3Key, deleted: true });
});

// Step 2 (optional): confirm the object landed in S3 before saving the post.
export const confirm = asyncHandler(async (req, res) => {
  const { s3Key } = req.body || {};
  if (!s3Key) throw ApiError.badRequest('s3Key is required');
  const head = await s3.headObject(s3Key);
  if (!head.exists) throw ApiError.badRequest('object not found in S3 — upload may have failed');
  sendSuccess(res, head);
});
