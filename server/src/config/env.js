// Centralized, validated environment config. server.js loads the root .env
// before this module is imported, so process.env is already populated.

function bool(v, def = false) {
  if (v === undefined) return def;
  return String(v).toLowerCase() === 'true';
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',

  databaseUrl: process.env.DATABASE_URL || '',
  dbSsl: bool(process.env.DB_SSL, false),

  jwtSecret: process.env.JWT_SECRET || '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // Machine auth for n8n -> /api/scheduler/* (was SCHEDULER_SECRET in the plan).
  serviceToken: process.env.SERVICE_TOKEN || process.env.SCHEDULER_SECRET || '',

  aws: {
    region: process.env.AWS_REGION || '',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucket: process.env.AWS_S3_BUCKET_NAME || '',
  },
  uploadUrlTtl: Number(process.env.UPLOAD_URL_TTL_SECONDS) || 300, // 5 min
  downloadUrlTtl: Number(process.env.DOWNLOAD_URL_TTL_SECONDS) || 3600, // 1 hr
};

// Warn (don't crash) on missing config so the server still boots for partial use.
export function validateEnv(logger = console) {
  const warnings = [];
  if (!env.databaseUrl) warnings.push('DATABASE_URL is not set — all DB-backed endpoints return 503.');
  if (!env.jwtSecret) warnings.push('JWT_SECRET is not set — using an ephemeral dev secret (tokens reset on restart).');
  if (!env.serviceToken) warnings.push('SERVICE_TOKEN is not set — /api/scheduler/* endpoints are disabled (503).');
  if (!env.aws.bucket || !env.aws.region) warnings.push('AWS S3 not fully configured — upload + presigned URLs will fail.');
  for (const w of warnings) logger.warn(`[env] ${w}`);
  return warnings;
}

export default env;
