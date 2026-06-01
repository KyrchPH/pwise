import api from './api.js';

// 1) Ask the server for a presigned PUT URL.
export async function getPresignedUrl(filename, contentType) {
  const { data } = await api.post('/upload/presigned-url', { filename, contentType });
  return data.data; // { uploadUrl, s3Key, mediaUrl }
}

// 2) Upload the file bytes straight to S3 (bare fetch — no auth header to S3).
export async function uploadToS3(uploadUrl, file) {
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type },
  });
  if (!res.ok) throw new Error(`S3 upload failed (HTTP ${res.status})`);
}

// 3) Optionally confirm the object exists before saving the post.
export async function confirm(s3Key) {
  const { data } = await api.post('/upload/confirm', { s3Key });
  return data.data;
}
