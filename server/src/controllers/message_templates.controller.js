import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/message_templates.service.js';

// Per-page message templates (canned replies). Page scope comes from accountId
// (query on reads, body on writes). Any messaging-access user may manage them.

export const list = asyncHandler(async (req, res) => {
  sendSuccess(res, { templates: await service.list(req.query.accountId) });
});

export const create = asyncHandler(async (req, res) => {
  const { accountId, title, body, tags } = req.body || {};
  sendSuccess(res, { template: await service.create(accountId, { title, body, tags }) }, 201);
});

export const update = asyncHandler(async (req, res) => {
  const { accountId, title, body, tags } = req.body || {};
  sendSuccess(res, { template: await service.update(req.params.id, accountId, { title, body, tags }) });
});

export const duplicate = asyncHandler(async (req, res) => {
  const { accountId } = req.body || {};
  sendSuccess(res, { template: await service.duplicate(req.params.id, accountId) }, 201);
});

export const remove = asyncHandler(async (req, res) => {
  const accountId = req.query.accountId ?? (req.body || {}).accountId;
  sendSuccess(res, await service.remove(req.params.id, accountId));
});
