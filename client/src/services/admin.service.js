import api from './api.js';

export async function createInvite() {
  const { data } = await api.post('/admin/invites');
  return data.data; // { token, link }
}

export async function listInvites() {
  const { data } = await api.get('/admin/invites');
  return data.data.invites;
}

export async function deleteInvite(id) {
  const { data } = await api.delete(`/admin/invites/${id}`);
  return data.data;
}

export async function listUsers() {
  const { data } = await api.get('/admin/users');
  return data.data.users;
}

export async function setActive(id, is_active) {
  const { data } = await api.patch(`/admin/users/${id}`, { is_active });
  return data.data;
}

export async function softDelete(id) {
  const { data } = await api.delete(`/admin/users/${id}`);
  return data.data;
}
