import api from './api.js';

// Trusted-device secrets live here, keyed by lowercased email — this is a shared-browser
// staff app, so user B "trusting" the browser must not clobber user A's token. The server
// issues the secret on trust; we only ever send back the one matching the entered email.
const DEVICE_KEY = 'trustedDevices';

function readDeviceMap() {
  try {
    return JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function getDeviceToken(email) {
  return readDeviceMap()[String(email || '').trim().toLowerCase()] || '';
}

export function setDeviceToken(email, token) {
  const map = readDeviceMap();
  map[String(email || '').trim().toLowerCase()] = token;
  localStorage.setItem(DEVICE_KEY, JSON.stringify(map));
}

// Step 1: password. Sends this browser's trusted-device token (if any) so a trusted
// device skips the OTP. Returns { user, token } (trusted) OR
// { otpRequired, email, expiresInMinutes, challengeToken } (new device).
export async function login(email, password) {
  const deviceToken = getDeviceToken(email) || undefined;
  const { data } = await api.post('/auth/login', { email, password, deviceToken });
  return data.data;
}

// Step 2: verify the emailed code (+ optionally trust this device). Returns
// { user, token, deviceToken? } — deviceToken present only when trustDevice was set.
export async function verifyLogin({ challengeToken, code, trustDevice }) {
  const { data } = await api.post('/auth/login/verify', { challengeToken, code, trustDevice });
  return data.data;
}

// Re-send the code for an in-flight login challenge.
export async function resendLoginCode(challengeToken) {
  const { data } = await api.post('/auth/login/resend', { challengeToken });
  return data.data; // { sent, email, expiresInMinutes }
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

// Name-only — email changes go through the OTP flow below.
export async function updateProfile(payload) {
  const { data } = await api.patch('/auth/me', { name: payload.name });
  return data.data.user;
}

// Email-verified email change. Step 1 sends a code to the CURRENT address.
export async function startEmailChange(newEmail) {
  const { data } = await api.post('/auth/email/start', { newEmail });
  return data.data; // { sent, email (masked current), newEmail, expiresInMinutes }
}

// Step 2 applies the change and returns the updated user.
export async function verifyEmailChange(code) {
  const { data } = await api.post('/auth/email/verify', { code });
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
