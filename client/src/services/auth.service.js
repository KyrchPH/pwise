import api from './api.js';

export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  return data.data; // { user, token }
}

export async function register(payload) {
  const { data } = await api.post('/auth/register', payload); // payload includes the invite token
  return data.data; // { user, token }
}

export async function validateInvite(token) {
  const { data } = await api.get(`/auth/invite/${encodeURIComponent(token)}`);
  return data.data; // { valid: true } — throws if invalid/used/expired
}

export async function me() {
  const { data } = await api.get('/auth/me');
  return data.data.user;
}

export async function updateProfile(payload) {
  const { data } = await api.patch('/auth/me', payload);
  return data.data.user;
}

export async function updateAvatar(payload) {
  const { data } = await api.patch('/auth/me/avatar', payload);
  return data.data.user;
}

export async function logout() {
  await api.post('/auth/logout');
}

// Log out of all OTHER devices (revoke every other session). This device's session
// stays valid, so its token keeps working.
export async function logoutAll() {
  const { data } = await api.post('/auth/logout-all');
  return data.data; // { ok }
}

// This user's sessions (active + revoked), newest first, the current one flagged.
export async function sessions() {
  const { data } = await api.get('/auth/sessions');
  return data.data.sessions; // [{ id, ip, userAgent, createdAt, lastSeenAt, revokedAt, current }]
}

// Revoke ONE session — log out a specific device.
export async function revokeSession(id) {
  const { data } = await api.delete(`/auth/sessions/${id}`);
  return data.data; // { revoked }
}

// Email-verified password change, 3 steps.
export async function startPasswordChange(currentPassword) {
  const { data } = await api.post('/auth/password/start', { currentPassword });
  return data.data; // { sent, email (masked), expiresInMinutes }
}

export async function verifyPasswordCode(code) {
  const { data } = await api.post('/auth/password/verify', { code });
  return data.data; // { verified: true }
}

export async function completePasswordChange(newPassword) {
  const { data } = await api.post('/auth/password/complete', { newPassword });
  return data.data; // { changed: true }
}
