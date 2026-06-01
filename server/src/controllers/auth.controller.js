import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as authService from '../services/auth.service.js';

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
  // JWT is stateless — the client discards the token. Endpoint exists for symmetry.
  sendSuccess(res, { message: 'logged out' });
});
