import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/wise_assistant.service.js';

export const ask = asyncHandler(async (req, res) => {
  // req.sessionId feeds the short-lived read-only token the n8n agent uses to fetch
  // this user's data back through the API (see wise_assistant.service.ask).
  const result = await service.ask(req.user, req.sessionId, req.body || {});
  sendSuccess(res, result);
});

// The user's saved Rovi conversation, loaded on widget mount so it follows them
// across devices. Returns { messages: [{ role, text }] } (intro added client-side).
export const history = asyncHandler(async (req, res) => {
  sendSuccess(res, { messages: await service.getHistory(req.user) });
});
