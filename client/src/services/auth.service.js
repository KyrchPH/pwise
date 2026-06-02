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

export async function logout() {
  await api.post('/auth/logout');
}
