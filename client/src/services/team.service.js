import api, { apiError } from './api.js';

// Agent-to-agent (internal team) chat API. Real-time updates arrive over the shared
// messaging SSE stream — reuse messaging.subscribe and filter for `team:*` events.

export async function listConversations() {
  const { data } = await api.get('/team/conversations');
  return data.data.conversations;
}

export async function searchAgents(q = '') {
  const { data } = await api.get('/team/agents', { params: { q } });
  return data.data.agents; // [{ id, name, email }]
}

export async function getConversation(id) {
  const { data } = await api.get(`/team/conversations/${id}`);
  return data.data.conversation;
}

export async function createConversation(payload) {
  const { data } = await api.post('/team/conversations', payload);
  return data.data.conversation;
}

export async function sendMessage(id, payload) {
  const { data } = await api.post(`/team/conversations/${id}/messages`, payload);
  return data.data; // { message }
}

export async function markSeen(id) {
  await api.post(`/team/conversations/${id}/seen`);
}

export async function rename(id, name) {
  const { data } = await api.patch(`/team/conversations/${id}`, { name });
  return data.data.conversation;
}

export async function addMembers(id, userIds) {
  const { data } = await api.post(`/team/conversations/${id}/participants`, { userIds });
  return data.data.conversation;
}

export async function removeMember(id, userId) {
  const { data } = await api.delete(`/team/conversations/${id}/participants/${userId}`);
  return data.data.conversation;
}

export async function leave(id) {
  await api.post(`/team/conversations/${id}/leave`);
}

export { apiError };
