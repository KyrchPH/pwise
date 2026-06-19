import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/wise_assistant.service.js';

export const ask = asyncHandler(async (req, res) => {
  const result = await service.ask(req.user, req.body || {});
  sendSuccess(res, result);
});
