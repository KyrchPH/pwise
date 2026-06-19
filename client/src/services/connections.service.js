import api, { apiError } from './api.js';

// Agent-to-agent connections ("friends"). Real-time updates arrive over the shared
// messaging SSE stream as connection:request / connection:changed events.

export async function list() {
  const { data } = await api.get('/connections');
  return data.data; // { connections, incoming, outgoing }
}

export async function search(q = '') {
  const { data } = await api.get('/connections/search', { params: { q } });
  return data.data.people; // [{ id, name, email, status }]
}

export async function request(userId) {
  const { data } = await api.post('/connections/request', { userId });
  return data.data; // { status }
}

export async function accept(userId) {
  const { data } = await api.post(`/connections/${userId}/accept`);
  return data.data;
}

export async function decline(userId) {
  const { data } = await api.post(`/connections/${userId}/decline`);
  return data.data;
}

export async function cancel(userId) {
  const { data } = await api.post(`/connections/${userId}/cancel`);
  return data.data;
}

export async function remove(userId) {
  const { data } = await api.delete(`/connections/${userId}`);
  return data.data;
}

export { apiError };
