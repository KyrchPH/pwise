import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/conversation_notes.service.js';

// Per-conversation notes (immutable, author-stamped). conversationId rides the query
// on reads and the body on create; the author comes from req.user. Delete is gated to
// admins at the route — there's no update (notes can't be edited).

export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, { notes: await service.list(req.query.conversationId) });
});

export const create = asyncHandler(async (req, res) => {
  const { conversationId, body } = req.body || {};
  sendSuccess(res, { note: await service.create(conversationId, req.user, { body }) }, 201);
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await service.remove(req.params.id));
});
