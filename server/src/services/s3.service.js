import { GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3Client, S3_BUCKET } from '../config/s3.js';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

function ensureConfigured() {
  if (!s3Client || !S3_BUCKET) throw new ApiError(503, 'S3 is not configured on the server');
}

// Presigned PUT — the client uploads the file bytes directly to S3.
export async function createUploadUrl(s3Key, contentType) {
  ensureConfigured();
  const command = new PutObjectCommand({ Bucket: S3_BUCKET, Key: s3Key, ContentType: contentType });
  return getSignedUrl(s3Client, command, { expiresIn: env.uploadUrlTtl });
}

// Presigned GET URLs are cached and reused per object for most of their lifetime,
// so the SAME url is handed out across requests. A freshly-signed url every time
// is a new query string → the browser can never cache the media (cache misses on
// every reload). Reusing one stable url lets the browser cache it — and keeps the
// post-list JSON stable so its ETag/304 works too. We also ask S3 to return a
// browser-cacheable Cache-Control header on the response (no upload change needed).
// The url is regenerated ~10 min before it expires, so a handed-out url always has
// comfortable validity left.
const downloadUrlCache = new Map(); // `${s3Key}|${expiresIn}` -> { url, refreshAfter }
const URL_REFRESH_BUFFER_MS = 10 * 60 * 1000;

// Presigned GET — a temporary, Meta-reachable URL for a private object.
export async function createDownloadUrl(s3Key, expiresIn = env.downloadUrlTtl) {
  ensureConfigured();
  const cacheKey = `${s3Key}|${expiresIn}`;
  const now = Date.now();
  const cached = downloadUrlCache.get(cacheKey);
  if (cached && now < cached.refreshAfter) return cached.url;

  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
    ResponseCacheControl: `public, max-age=${expiresIn}`, // browser-cacheable media
  });
  const url = await getSignedUrl(s3Client, command, { expiresIn });

  if (downloadUrlCache.size > 1000) downloadUrlCache.clear(); // safety: bound growth
  downloadUrlCache.set(cacheKey, { url, refreshAfter: now + Math.max(0, expiresIn * 1000 - URL_REFRESH_BUFFER_MS) });
  return url;
}

// Verify an uploaded object exists (used by /upload/confirm).
export async function headObject(s3Key) {
  ensureConfigured();
  try {
    const out = await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
    return { exists: true, size: out.ContentLength, contentType: out.ContentType };
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return { exists: false };
    throw err;
  }
}

// Canonical object URL (stored as metadata; not directly fetchable on a private bucket).
export function publicObjectUrl(s3Key) {
  return `https://${S3_BUCKET}.s3.${env.aws.region}.amazonaws.com/${s3Key}`;
}
