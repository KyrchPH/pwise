import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/activity.service.js';

export const list = asyncHandler(async (req, res) => {
  const { limit, offset } = req.query;
  sendSuccess(res, await service.list({ limit, offset }));
});
