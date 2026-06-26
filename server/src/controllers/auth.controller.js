import asyncHandler from '../utils/asyncHandler.js';
import { sendSuccess } from '../utils/response.util.js';
import * as authService from '../services/auth.service.js';
import * as invitesService from '../services/invites.service.js';

// Best-effort client IP behind nginx (X-Forwarded-For first hop), else the socket.
function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.ip || req.socket?.remoteAddress || '';
}

export const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body || {}, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
  sendSuccess(res, result, 201);
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body || {}, { ip: clientIp(req), userAgent: req.headers['user-agent'] });
  sendSuccess(res, result);
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getById(req.user.id);
  sendSuccess(res, { user });
});

export const updateMe = asyncHandler(async (req, res) => {
  const user = await authService.updateProfile(req.user.id, req.body || {});
  sendSuccess(res, { user });
});

export const updateAvatar = asyncHandler(async (req, res) => {
  const user = await authService.updateAvatar(req.user.id, req.body || {});
  sendSuccess(res, { user });
});

export const logout = asyncHandler(async (req, res) => {
  // Revoke THIS session server-side, then the client discards its token.
  await authService.revokeSession(req.user.id, req.sessionId);
  sendSuccess(res, { message: 'logged out' });
});

// Log out of all OTHER devices: revoke every session except the current one (its token
// stays valid, so this device is unaffected).
export const logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutOtherSessions(req.user.id, req.sessionId);
  sendSuccess(res, { ok: true });
});

// Revoke ONE session (log out a specific device) by its id.
export const revokeSession = asyncHandler(async (req, res) => {
  sendSuccess(res, await authService.revokeSession(req.user.id, req.params.id));
});

// The signed-in user's sessions (active + revoked), newest first, with the current one
// flagged — powers the Profile → Security list.
export const sessions = asyncHandler(async (req, res) => {
  const items = await authService.listSessions(req.user.id);
  sendSuccess(res, { sessions: items.map((s) => ({ ...s, current: s.id === req.sessionId })) });
});

// Public: checks whether an invite link is still usable, so the signup page
// can show the form (or an error) before the user fills it in.
export const validateInvite = asyncHandler(async (req, res) => {
  await invitesService.findUsable(req.params.token);
  sendSuccess(res, { valid: true });
});

// Email-verified password change (all authenticated; act on req.user.id).
export const startPasswordChange = asyncHandler(async (req, res) => {
  const result = await authService.startPasswordChange(req.user.id, (req.body || {}).currentPassword);
  sendSuccess(res, result);
});

export const verifyPasswordCode = asyncHandler(async (req, res) => {
  const result = await authService.verifyPasswordCode(req.user.id, (req.body || {}).code);
  sendSuccess(res, result);
});

export const completePasswordChange = asyncHandler(async (req, res) => {
  const result = await authService.completePasswordChange(req.user.id, (req.body || {}).newPassword);
  sendSuccess(res, result);
});
