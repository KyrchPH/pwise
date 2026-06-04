import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/analytics.service.js';

// Page analytics overview for the Analytics dashboard. `range` = days (7..365).
export const overview = asyncHandler(async (req, res) => {
  const rangeDays = Math.min(Math.max(Number(req.query.range) || 28, 7), 365);
  const data = await service.overview({ rangeDays });
  sendSuccess(res, data);
});
