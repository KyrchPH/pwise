import api from './api.js';

// Per-page message templates (canned replies). Every call is scoped to a page via
// accountId; the server seeds the built-in defaults the first time a page is read.

export async function list(accountId) {
  const { data } = await api.get('/message-templates', { params: { accountId } });
  return data.data.templates; // [{ id, title, body, tags }]
}

export async function create(accountId, payload) {
  const { data } = await api.post('/message-templates', { accountId, ...payload });
  return data.data.template;
}

export async function update(id, accountId, payload) {
  const { data } = await api.patch(`/message-templates/${id}`, { accountId, ...payload });
  return data.data.template;
}

export async function duplicate(id, accountId) {
  const { data } = await api.post(`/message-templates/${id}/duplicate`, { accountId });
  return data.data.template;
}

export async function remove(id, accountId) {
  const { data } = await api.delete(`/message-templates/${id}`, { params: { accountId } });
  return data.data;
}
