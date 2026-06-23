import api from './api.js';

// Per-page products (Workspace → Products + the chat composer's Products drawer).
// Each product's `photoUrl` is a freshly-presigned S3 link (the server stores a key).
export async function list(accountId) {
  const { data } = await api.get('/page-products', { params: { accountId } });
  return data.data.products;
}

export async function create(payload) {
  const { data } = await api.post('/page-products', payload);
  return data.data.product;
}

export async function update(id, payload) {
  const { data } = await api.patch(`/page-products/${id}`, payload);
  return data.data.product;
}

export async function remove(id) {
  const { data } = await api.delete(`/page-products/${id}`);
  return data.data;
}
