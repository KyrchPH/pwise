import api from './api.js';

// "User Roles" — named module-access presets managed on the Accounts page.

export async function listRoles() {
  const { data } = await api.get('/admin/roles');
  return data.data.roles; // [{ id, name, module_access, member_count }]
}

export async function createRole(payload) {
  const { data } = await api.post('/admin/roles', payload); // { name, modules }
  return data.data;
}

export async function updateRole(id, payload) {
  const { data } = await api.patch(`/admin/roles/${id}`, payload); // { name?, modules? }
  return data.data;
}

export async function deleteRole(id) {
  const { data } = await api.delete(`/admin/roles/${id}`);
  return data.data;
}
