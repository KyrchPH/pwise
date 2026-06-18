import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/logs.service.js';

export const list = asyncHandler(async (req, res) => {
  const { limit, offset } = req.query;
  sendSuccess(res, await service.list({ limit, offset }));
});

export const get = asyncHandler(async (req, res) => {
  const log = await service.getById(req.user.id, req.params.id);
  sendSuccess(res, { log });
});
