import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as roles from '../services/roles.service.js';

export const listRoles = asyncHandler(async (req, res) => {
  const list = await roles.list();
  sendSuccess(res, { roles: list });
});

export const createRole = asyncHandler(async (req, res) => {
  const role = await roles.create(req.user.id, { name: req.body?.name, modules: req.body?.modules });
  sendSuccess(res, role, 201);
});

export const updateRole = asyncHandler(async (req, res) => {
  const role = await roles.update(req.params.id, { name: req.body?.name, modules: req.body?.modules });
  sendSuccess(res, role);
});

export const deleteRole = asyncHandler(async (req, res) => {
  const result = await roles.remove(req.params.id);
  sendSuccess(res, result);
});
