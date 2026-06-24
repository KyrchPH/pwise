import api from './api.js';

// Per-conversation notes (immutable, author-stamped). Scoped to a thread via
// conversationId; creating is open to any Messaging user, deleting is admin-only.

export async function list(conversationId) {
  const { data } = await api.get('/conversation-notes', { params: { conversationId } });
  return data.data.notes; // [{ id, conversationId, body, createdBy, createdByName, createdAt }]
}

export async function create(conversationId, body) {
  const { data } = await api.post('/conversation-notes', { conversationId, body });
  return data.data.note;
}

export async function remove(id) {
  const { data } = await api.delete(`/conversation-notes/${id}`);
  return data.data;
}
