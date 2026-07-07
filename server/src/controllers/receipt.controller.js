import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/receipt.service.js';

// Shop → Receipts. Owner-scoped document/photo storage; admins bypass. All routes JWT-authed.
// Files are uploaded directly to S3 via the /upload presign (receipt kind); this records the
// resulting object + serves short-lived presigned read URLs.
export const list = asyncHandler(async (req, res) => {
  const receipts = await service.list({ actor: req.user, accountId: req.query.accountId, ownerId: req.query.ownerId || null });
  sendSuccess(res, { receipts });
});

export const create = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const receipt = await service.create({
    actor: req.user,
    accountId: b.accountId,
    s3Key: b.s3Key,
    contentType: b.contentType,
    fileSize: b.fileSize,
    title: b.title,
    note: b.note,
    orderId: b.orderId,
  });
  sendSuccess(res, { receipt }, 201);
});

export const download = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getDownloadUrl(req.params.id, req.user));
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.remove(req.params.id, req.user));
});
