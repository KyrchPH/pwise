import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as authService from '../services/auth.service.js';
import * as invitesService from '../services/invites.service.js';

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body || {});
  sendSuccess(res, result, 201);
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body || {});
  sendSuccess(res, result);
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getById(req.user.id);
  sendSuccess(res, { user });
});

export const logout = asyncHandler(async (req, res) => {
  // JWT is stateless — the client discards the token.
  sendSuccess(res, { message: 'logged out' });
});

// Public: checks whether an invite link is still usable, so the signup page
// can show the form (or an error) before the user fills it in.
export const validateInvite = asyncHandler(async (req, res) => {
  await invitesService.findUsable(req.params.token);
  sendSuccess(res, { valid: true });
});
