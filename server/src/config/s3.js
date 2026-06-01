import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

// If explicit keys are absent, fall back to the default AWS provider chain
// (useful when the server runs on EC2 with an IAM role).
const credentials =
  env.aws.accessKeyId && env.aws.secretAccessKey
    ? { accessKeyId: env.aws.accessKeyId, secretAccessKey: env.aws.secretAccessKey }
    : undefined;

export const s3Client = env.aws.region
  ? new S3Client({ region: env.aws.region, credentials })
  : null;

export const S3_BUCKET = env.aws.bucket;

export default s3Client;
