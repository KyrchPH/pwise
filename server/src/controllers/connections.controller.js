import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as connections from '../services/connections.service.js';

// Agent-to-agent connections ("friends"). Access checks + auto-request live in the
// service; the controller maps req → service → response envelope.

export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, await connections.listAll(req.user));
});

export const search = asyncHandler(async (req, res) => {
  sendSuccess(res, { people: await connections.searchPeople(req.user, req.query.q || '') });
});

export const request = asyncHandler(async (req, res) => {
  sendSuccess(res, await connections.sendRequest(req.user, (req.body || {}).userId), 201);
});

export const accept = asyncHandler(async (req, res) => {
  sendSuccess(res, await connections.accept(req.user, req.params.userId));
});

export const decline = asyncHandler(async (req, res) => {
  sendSuccess(res, await connections.decline(req.user, req.params.userId));
});

export const cancel = asyncHandler(async (req, res) => {
  sendSuccess(res, await connections.cancel(req.user, req.params.userId));
});

export const remove = asyncHandler(async (req, res) => {
  sendSuccess(res, await connections.remove(req.user, req.params.userId));
});
