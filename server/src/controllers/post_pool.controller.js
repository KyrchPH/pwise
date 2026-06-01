import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/post_pool.service.js';

export const list = asyncHandler(async (req, res) => {
  const { status, limit, offset } = req.query;
  const posts = await service.list(req.user.id, { status, limit, offset });
  sendSuccess(res, { posts });
});

export const create = asyncHandler(async (req, res) => {
  const post = await service.create(req.user.id, req.body || {});
  sendSuccess(res, { post }, 201);
});

export const get = asyncHandler(async (req, res) => {
  const post = await service.getById(req.user.id, req.params.id);
  sendSuccess(res, { post });
});

export const update = asyncHandler(async (req, res) => {
  const post = await service.update(req.user.id, req.params.id, req.body || {});
  sendSuccess(res, { post });
});

export const remove = asyncHandler(async (req, res) => {
  const result = await service.remove(req.user.id, req.params.id);
  sendSuccess(res, result);
});

export const counts = asyncHandler(async (req, res) => {
  const counts = await service.counts(req.user.id);
  sendSuccess(res, { counts });
});
