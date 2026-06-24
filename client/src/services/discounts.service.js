import api from './api.js';

// Per-page discount rules (Shop → Discounts). Mirrors products.service.js.
export async function list(accountId) {
  const { data } = await api.get('/page-discounts', { params: { accountId } });
  return data.data.discounts;
}

export async function create(payload) {
  const { data } = await api.post('/page-discounts', payload);
  return data.data.discount;
}

export async function update(id, payload) {
  const { data } = await api.patch(`/page-discounts/${id}`, payload);
  return data.data.discount;
}

export async function remove(id) {
  const { data } = await api.delete(`/page-discounts/${id}`);
  return data.data;
}
