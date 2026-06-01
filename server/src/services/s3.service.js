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

// Presigned GET — a temporary, Meta-reachable URL for a private object.
export async function createDownloadUrl(s3Key, expiresIn = env.downloadUrlTtl) {
  ensureConfigured();
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
  return getSignedUrl(s3Client, command, { expiresIn });
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
