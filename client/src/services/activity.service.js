import api from './api.js';

// The shared post activity log (who created/edited/deleted each post).
export async function list() {
  const { data } = await api.get('/activity');
  return data.data.activity;
}
