import api from './api.js';
import { generateThumbnail } from './thumbnail.service.js';

// 1) Ask the server for a presigned PUT URL. Pass { temporary: true } for files
//    that should live under tmp/ (auto-expiring), e.g. a template's input video.
//    Pass { vault: true } for the file manager — it allows ANY file type (not just
//    image/video) and stores under vault/.
export async function getPresignedUrl(filename, contentType, { temporary = false, vault = false, avatar = false, receipt = false } = {}) {
  const { data } = await api.post('/upload/presigned-url', { filename, contentType, temporary, vault, avatar, receipt });
  return data.data; // { uploadUrl, s3Key, mediaUrl }
}

// Delete a temporary upload (e.g. an abandoned template input video).
export async function discard(s3Key) {
  const { data } = await api.post('/upload/discard', { s3Key });
  return data.data;
}

// 2) Upload the file bytes straight to S3 (bare XHR — no auth header to S3).
//    Uses XMLHttpRequest instead of fetch so we can report upload progress:
//    onProgress(percent) is called 0..100 as the bytes go up. Large images and
//    videos otherwise look frozen because fetch gives no upload progress events.
export function uploadToS3(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    // Must match the contentType the presigned URL was signed with — files with no
    // MIME type fall back to octet-stream on both sides (see getPresignedUrl callers).
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = (e) => {
      if (onProgress && e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        resolve();
      } else {
        reject(new Error(`S3 upload failed (HTTP ${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error('S3 upload failed (network error)'));
    xhr.onabort = () => reject(new Error('S3 upload canceled'));

    xhr.send(file);
  });
}

// 3) Optionally confirm the object exists before saving the post.
export async function confirm(s3Key) {
  const { data } = await api.post('/upload/confirm', { s3Key });
  return data.data;
}

// 4) Build an optimized preview thumbnail (first video frame / downscaled image)
//    for `file` in the browser and upload it to S3 as its own object. Returns
//    { s3Key } for the thumbnail, or null when the browser can't make one — it's
//    best-effort, so a post is still saved (just without a thumbnail) on failure.
export async function uploadThumbnail(file, { temporary = false, vault = false } = {}) {
  const blob = await generateThumbnail(file);
  if (!blob) return null;
  const base = String(file.name || 'media').replace(/\.[^./\\]+$/, ''); // drop the extension
  const name = `${base}.thumb.jpg`;
  const pres = await getPresignedUrl(name, 'image/jpeg', { temporary, vault });
  await uploadToS3(pres.uploadUrl, new File([blob], name, { type: 'image/jpeg' }));
  return { s3Key: pres.s3Key };
}
