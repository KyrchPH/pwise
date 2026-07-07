import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as service from '../services/content_notes.service.js';

// Shared pool: reads aren't user-scoped (everyone sees every note). Writes pass
// the acting user (req.user = { id, name, ... }) so the author is recorded.
export const list = asyncHandler(async (req, res) => {
  const notes = await service.listByDate(req.query.date);
  sendSuccess(res, { notes });
});

export const month = asyncHandler(async (req, res) => {
  const counts = await service.monthCounts(req.query.year, req.query.month);
  sendSuccess(res, { counts });
});

export const create = asyncHandler(async (req, res) => {
  const note = await service.create(req.user, req.body || {});
  sendSuccess(res, { note }, 201);
});

export const update = asyncHandler(async (req, res) => {
  const note = await service.update(req.params.id, req.body || {}, req.user);
  sendSuccess(res, { note });
});

export const setStatus = asyncHandler(async (req, res) => {
  const note = await service.setStatus(req.params.id, req.body || {}, req.user);
  sendSuccess(res, { note });
});

export const setDate = asyncHandler(async (req, res) => {
  const note = await service.setDate(req.params.id, req.body || {}, req.user);
  sendSuccess(res, { note });
});

export const setColor = asyncHandler(async (req, res) => {
  const note = await service.setColor(req.params.id, req.body || {}, req.user);
  sendSuccess(res, { note });
});

export const reorder = asyncHandler(async (req, res) => {
  const { date, ids } = req.body || {};
  const notes = await service.reorder(date, ids, req.user);
  sendSuccess(res, { notes });
});

export const remove = asyncHandler(async (req, res) => {
  const result = await service.remove(req.params.id, req.user);
  sendSuccess(res, result);
});
