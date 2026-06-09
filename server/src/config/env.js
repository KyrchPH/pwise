// Centralized, validated environment config. server.js loads the root .env
// before this module is imported, so process.env is already populated.

function bool(v, def = false) {
  if (v === undefined) return def;
  return String(v).toLowerCase() === 'true';
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 5000,
  clientUrl: (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/+$/, ''), // tolerate a trailing slash

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

  // Facebook Page Graph API — used for USER-INITIATED delete/edit of already
  // published posts. (n8n still owns publishing.) Token needs pages_manage_posts.
  facebook: {
    pageAccessToken: process.env.FACEBOOK_PAGE_ACCESS_TOKEN || '',
    graphVersion: process.env.FB_GRAPH_VERSION || 'v21.0',
    pageId: process.env.FACEBOOK_PAGE_ID || '',
  },

  // "Generate with Template" delegates rendering to n8n (the "Post to n8n"
  // webhook), which holds the Creatomate credential and runs the render — so the
  // server needs the webhook URL, NOT a Creatomate API key. `videoKey` is the
  // template element the input video is injected into (Creatomate's docs + the
  // n8n flow both use "Background-Video").
  creatomate: {
    videoKey: process.env.CREATOMATE_VIDEO_KEY || 'Background-Video',
  },
  n8n: {
    generateWebhookUrl: process.env.N8N_GENERATE_WEBHOOK_URL || '',
    webhookToken: process.env.N8N_WEBHOOK_TOKEN || '', // optional: sent as x-service-token
  },

  // At-rest encryption key for connected-page credentials (platform_accounts).
  // 64 hex chars: `openssl rand -hex 32`.
  encryptionKey: process.env.ENCRYPTION_KEY || '',
};

// Warn (don't crash) on missing config so the server still boots for partial use.
export function validateEnv(logger = console) {
  const warnings = [];
  if (!env.databaseUrl) warnings.push('DATABASE_URL is not set — all DB-backed endpoints return 503.');
  if (!env.jwtSecret) warnings.push('JWT_SECRET is not set — using an ephemeral dev secret (tokens reset on restart).');
  if (!env.serviceToken) warnings.push('SERVICE_TOKEN is not set — /api/scheduler/* endpoints are disabled (503).');
  if (!env.aws.bucket || !env.aws.region) warnings.push('AWS S3 not fully configured — upload + presigned URLs will fail.');
  if (!env.facebook.pageAccessToken) warnings.push('FACEBOOK_PAGE_ACCESS_TOKEN is not set — deleting/editing published posts on Facebook will fail (503).');
  if (!env.n8n.generateWebhookUrl) warnings.push('N8N_GENERATE_WEBHOOK_URL is not set — "Generate with Template" will fail (503).');
  if (!env.encryptionKey) warnings.push('ENCRYPTION_KEY is not set — adding/using connected Facebook pages will fail (503).');
  for (const w of warnings) logger.warn(`[env] ${w}`);
  return warnings;
}

export default env;
