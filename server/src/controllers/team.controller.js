import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as team from '../services/team.service.js';

// Agent-to-agent (internal team) chat endpoints. All participant/access checks
// live in the service; the controller just maps req → service → response envelope.

export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, { conversations: await team.listConversations(req.user) });
});

export const agents = asyncHandler(async (req, res) => {
  sendSuccess(res, { agents: await team.searchAgents(req.user, req.query.q || '') });
});

export const create = asyncHandler(async (req, res) => {
  sendSuccess(res, { conversation: await team.createConversation(req.user, req.body || {}) }, 201);
});

export const get = asyncHandler(async (req, res) => {
  sendSuccess(res, { conversation: await team.getConversation(req.params.id, req.user) });
});

export const send = asyncHandler(async (req, res) => {
  sendSuccess(res, await team.sendMessage(req.params.id, req.user, req.body || {}), 201);
});

export const seen = asyncHandler(async (req, res) => {
  sendSuccess(res, await team.markSeen(req.params.id, req.user));
});

export const rename = asyncHandler(async (req, res) => {
  sendSuccess(res, { conversation: await team.rename(req.params.id, req.user, (req.body || {}).name) });
});

export const addMembers = asyncHandler(async (req, res) => {
  sendSuccess(res, { conversation: await team.addParticipants(req.params.id, req.user, (req.body || {}).userIds) });
});

export const removeMember = asyncHandler(async (req, res) => {
  sendSuccess(res, { conversation: await team.removeParticipant(req.params.id, req.user, req.params.userId) });
});

export const leave = asyncHandler(async (req, res) => {
  sendSuccess(res, await team.leave(req.params.id, req.user));
});
