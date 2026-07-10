import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import ApiError from '../utils/ApiError.js';
import * as invites from '../services/invites.service.js';
import * as admin from '../services/admin.service.js';
import * as appSettings from '../services/app_settings.service.js';

// Invites -------------------------------------------------------------------
export const createInvite = asyncHandler(async (req, res) => {
  const invite = await invites.create(req.user.id, req.body?.modules, req.body?.role_id);
  sendSuccess(res, invite, 201); // { token, link }
});

export const listInvites = asyncHandler(async (req, res) => {
  const list = await invites.list();
  sendSuccess(res, { invites: list });
});

export const deleteInvite = asyncHandler(async (req, res) => {
  const result = await invites.remove(req.params.id);
  sendSuccess(res, result);
});

// Accounts ------------------------------------------------------------------
export const listUsers = asyncHandler(async (req, res) => {
  const users = await admin.listUsers();
  sendSuccess(res, { users });
});

export const setActive = asyncHandler(async (req, res) => {
  const active = req.body?.is_active;
  if (typeof active !== 'boolean') throw ApiError.badRequest('is_active (boolean) is required');
  if (Number(req.params.id) === req.user.id) throw ApiError.badRequest("you can't change your own account status");
  const result = await admin.setActive(req.params.id, active);
  sendSuccess(res, result);
});

export const softDelete = asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.user.id) throw ApiError.badRequest("you can't delete your own account");
  const result = await admin.softDelete(req.params.id);
  sendSuccess(res, result);
});

export const unlockAccount = asyncHandler(async (req, res) => {
  const result = await admin.unlockAccount(req.params.id);
  sendSuccess(res, result);
});

export const setModuleAccess = asyncHandler(async (req, res) => {
  if (Number(req.params.id) === req.user.id) throw ApiError.badRequest("you can't change your own access");
  const result = await admin.setModuleAccess(req.params.id, { modules: req.body?.modules, roleId: req.body?.role_id });
  sendSuccess(res, result);
});

export const setRole = asyncHandler(async (req, res) => {
  const result = await admin.setRole(req.user, req.params.id, req.body?.role);
  sendSuccess(res, result);
});

export const transferSuperAdmin = asyncHandler(async (req, res) => {
  const result = await admin.transferSuperAdmin(req.user, req.params.id);
  sendSuccess(res, result);
});

// Global automation pause switches (app-wide) -------------------------------
export const getPause = asyncHandler(async (req, res) => {
  sendSuccess(res, await appSettings.getPauseState());
});

export const setPause = asyncHandler(async (req, res) => {
  const { aiPaused, postingPaused } = req.body || {};
  sendSuccess(res, await appSettings.setPause({ aiPaused, postingPaused }, req.user.id));
});
