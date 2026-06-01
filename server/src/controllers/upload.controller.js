import crypto from 'node:crypto';
import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import ApiError from '../utils/ApiError.js';
import * as s3 from '../services/s3.service.js';

const ALLOWED_PREFIXES = ['image/', 'video/'];

// Step 1: client asks for a presigned PUT URL, then uploads bytes straight to S3.
export const presignedUrl = asyncHandler(async (req, res) => {
  const { filename, contentType } = req.body || {};
  if (!filename || !contentType) throw ApiError.badRequest('filename and contentType are required');
  if (!ALLOWED_PREFIXES.some((p) => String(contentType).startsWith(p))) {
    throw ApiError.badRequest('only image/* or video/* uploads are allowed');
  }
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const s3Key = `uploads/${req.user.id}/${crypto.randomUUID()}-${safeName}`;
  const uploadUrl = await s3.createUploadUrl(s3Key, contentType);
  sendSuccess(res, { uploadUrl, s3Key, mediaUrl: s3.publicObjectUrl(s3Key) });
});

// Step 2 (optional): confirm the object landed in S3 before saving the post.
export const confirm = asyncHandler(async (req, res) => {
  const { s3Key } = req.body || {};
  if (!s3Key) throw ApiError.badRequest('s3Key is required');
  const head = await s3.headObject(s3Key);
  if (!head.exists) throw ApiError.badRequest('object not found in S3 — upload may have failed');
  sendSuccess(res, head);
});
