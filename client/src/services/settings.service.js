import api from './api.js';

export async function get() {
  const { data } = await api.get('/settings');
  return data.data.settings;
}

export async function update(payload) {
  const { data } = await api.patch('/settings', payload);
  return data.data.settings;
}
