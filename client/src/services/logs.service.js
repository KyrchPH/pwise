import api from './api.js';

export async function list(params = {}) {
  const { data } = await api.get('/logs', { params });
  return data.data.logs;
}

export async function get(id) {
  const { data } = await api.get(`/logs/${id}`);
  return data.data.log;
}
