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
