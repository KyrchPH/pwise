import api from './api.js';

// The shared post activity log (who created/edited/deleted each post).
export async function list(params = {}) {
  const { data } = await api.get('/activity', { params });
  return data.data;
}
