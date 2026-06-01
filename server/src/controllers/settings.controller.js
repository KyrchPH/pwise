import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/settings.service.js';

export const get = asyncHandler(async (req, res) => {
  const settings = await service.getForUser(req.user.id, req.user.email);
  sendSuccess(res, { settings });
});

export const update = asyncHandler(async (req, res) => {
  const settings = await service.updateForUser(req.user.id, req.body || {});
  sendSuccess(res, { settings });
});
