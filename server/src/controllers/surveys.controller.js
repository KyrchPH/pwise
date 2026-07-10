import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/surveys.service.js';
import * as settings from '../services/settings.service.js';

// Customer satisfaction surveys. The public pair (get/respond) is tokenized and
// unauthenticated — the customer opens /survey/:token from the email. The summary is
// team-facing and day-lagged (today's sends are invisible until tomorrow) — see
// surveys.service.js for why.

export const publicGet = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.getPublic(req.params.token));
});

export const publicRespond = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.submitPublic(req.params.token, req.body || {}));
});

// Aggregates for Insights → Messaging, scoped to the caller's active page like the
// other analytics endpoints. ?range=<days>.
export const summary = asyncHandler(async (req, res) => {
  const rangeDays = Math.min(Math.max(Number(req.query.range) || 28, 1), 365);
  const requestedAccountId = Number(req.query.accountId);
  const accountId = Number.isInteger(requestedAccountId) && requestedAccountId > 0
    ? requestedAccountId
    : await settings.getSelectedAccountId(req.user.id);
  sendSuccess(res, await service.summary({ accountId, rangeDays }));
});
