import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
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
