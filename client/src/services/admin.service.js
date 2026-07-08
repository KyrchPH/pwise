import api from './api.js';

export async function createInvite(payload) {
  const { data } = await api.post('/admin/invites', payload);
  return data.data; // { token, link, module_access }
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

// Clear a brute-force lockout so the account can log in again.
export async function unlockAccount(id) {
  const { data } = await api.patch(`/admin/users/${id}/unlock`);
  return data.data; // { id, unlocked }
}

// Replace a user's module access. modules = array of module ids.
export async function setModuleAccess(id, modules) {
  const { data } = await api.patch(`/admin/users/${id}/access`, { modules });
  return data.data; // { id, module_access }
}
