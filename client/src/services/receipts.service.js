import api from './api.js';
import { getPresignedUrl, uploadToS3 } from './upload.service.js';

// Receipts — owner-scoped document/photo storage (Shop → Receipts). Each row comes back
// with a freshly-presigned `url` for viewing/downloading.
export async function list(accountId, { ownerId } = {}) {
  const { data } = await api.get('/receipts', { params: { accountId, ownerId: ownerId || undefined } });
  return data.data.receipts;
}

export async function create(payload) {
  const { data } = await api.post('/receipts', payload);
  return data.data.receipt;
}

export async function downloadUrl(id) {
  const { data } = await api.get(`/receipts/${id}/download`);
  return data.data.url;
}

export async function remove(id) {
  const { data } = await api.delete(`/receipts/${id}`);
  return data.data;
}

// Upload a photo or PDF straight to S3 (receipts/ prefix) then record it. Returns the
// created receipt (with its presigned url).
export async function upload(file, { accountId, title, note, onProgress } = {}) {
  const pres = await getPresignedUrl(file.name || 'receipt', file.type || 'application/octet-stream', { receipt: true });
  await uploadToS3(pres.uploadUrl, file, onProgress);
  return create({ accountId, s3Key: pres.s3Key, contentType: file.type || null, fileSize: file.size, title, note });
}
