import api from './api.js';

// Planner goals. The list endpoint returns { goals, summary } (summary drives the
// banner's overall progress bar); each goal is enriched server-side with
// current_value, progress and a reconciled status.
export async function list() {
  const { data } = await api.get('/planner/goals');
  return data.data;
}

export async function create(payload) {
  const { data } = await api.post('/planner/goals', payload);
  return data.data.goal;
}

export async function update(id, payload) {
  const { data } = await api.patch(`/planner/goals/${id}`, payload);
  return data.data.goal;
}

export async function remove(id) {
  const { data } = await api.delete(`/planner/goals/${id}`);
  return data.data;
}
