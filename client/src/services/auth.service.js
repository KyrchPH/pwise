import api from './api.js';

export async function login(email, password) {
  const { data } = await api.post('/auth/login', { email, password });
  return data.data; // { user, token }
}

export async function register(payload) {
  const { data } = await api.post('/auth/register', payload);
  return data.data; // { user, token }
}

export async function me() {
  const { data } = await api.get('/auth/me');
  return data.data.user;
}

export async function logout() {
  await api.post('/auth/logout');
}
