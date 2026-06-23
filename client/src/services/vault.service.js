import api from './api.js';

// Vault file-manager API. The whole tree is fetched once (list) and sliced
// per-folder client-side; mutations return the affected item.

export async function list() {
  const { data } = await api.get('/vault');
  return data.data.items; // [{ id, parentId, type, name, mediaType, size, uploadedBy, url, thumbUrl }]
}

export async function createFolder(parentId, name) {
  const { data } = await api.post('/vault/folder', { parentId: parentId ?? null, name });
  return data.data.item;
}

// Persist a file whose bytes are already in S3 (uploaded via a presigned URL).
//   payload: { parentId, name, s3Key, thumbnailS3Key, mediaType, mime, size }
export async function createFile(payload) {
  const { data } = await api.post('/vault/file', payload);
  return data.data.item;
}

// Move an item under a new parent folder (parentId null → root).
export async function move(id, parentId) {
  const { data } = await api.patch(`/vault/${id}/move`, { parentId: parentId ?? null });
  return data.data.item;
}

export async function remove(id) {
  const { data } = await api.delete(`/vault/${id}`);
  return data.data;
}

// Toggle a file's "Hide from AI" flag. Returns the updated item.
export async function setAiHidden(id, aiHidden) {
  const { data } = await api.patch(`/vault/${id}/ai-visibility`, { aiHidden });
  return data.data.item;
}

// Update a file's AI metadata — description + tags (tags as an array or a
// comma-separated string). Returns the updated item.
export async function updateMeta(id, { description, tags }) {
  const { data } = await api.patch(`/vault/${id}/meta`, { description, tags });
  return data.data.item;
}
