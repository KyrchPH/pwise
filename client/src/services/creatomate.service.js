import api from './api.js';

export async function list() {
  const { data } = await api.get('/creatomate-templates');
  return data.data.templates;
}

export async function create(payload) {
  const { data } = await api.post('/creatomate-templates', payload);
  return data.data.template;
}

export async function update(id, payload) {
  const { data } = await api.patch(`/creatomate-templates/${id}`, payload);
  return data.data.template;
}

export async function remove(id) {
  const { data } = await api.delete(`/creatomate-templates/${id}`);
  return data.data;
}
