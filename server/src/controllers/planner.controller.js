import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/planner.service.js';

// Planner goals are workspace-wide: everyone reads/manages every goal (like the
// post pool). Writes pass the acting user (req.user) so `created_by` is recorded.
export const list = asyncHandler(async (req, res) => {
  const { goals, summary } = await service.list();
  sendSuccess(res, { goals, summary });
});

export const get = asyncHandler(async (req, res) => {
  const goal = await service.getById(req.params.id);
  sendSuccess(res, { goal });
});

export const create = asyncHandler(async (req, res) => {
  const goal = await service.create(req.user, req.body || {});
  sendSuccess(res, { goal }, 201);
});

export const update = asyncHandler(async (req, res) => {
  const goal = await service.update(req.params.id, req.body || {});
  sendSuccess(res, { goal });
});

export const remove = asyncHandler(async (req, res) => {
  const result = await service.remove(req.params.id);
  sendSuccess(res, result);
});
