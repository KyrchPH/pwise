import api from './api.js';

// 1) Ask the server for a presigned PUT URL.
export async function getPresignedUrl(filename, contentType) {
  const { data } = await api.post('/upload/presigned-url', { filename, contentType });
  return data.data; // { uploadUrl, s3Key, mediaUrl }
}

// 2) Upload the file bytes straight to S3 (bare XHR — no auth header to S3).
//    Uses XMLHttpRequest instead of fetch so we can report upload progress:
//    onProgress(percent) is called 0..100 as the bytes go up. Large images and
//    videos otherwise look frozen because fetch gives no upload progress events.
export function uploadToS3(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type);

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
