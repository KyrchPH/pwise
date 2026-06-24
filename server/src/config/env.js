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

  // Public base URL of THIS API (used to register inbound webhooks with platforms,
  // e.g. https://pwise-api.sixpent.com — Telegram/Facebook POST customer messages there).
  publicUrl: (process.env.PUBLIC_URL || '').replace(/\/+$/, ''),
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '', // secret_token Telegram echoes back

  // Feature flag (runtime): when true, a live agent can hand a conversation BACK to
  // the AI agent from the inbox (double-click the customer's avatar in a Live Agent
  // thread). Off by default — meant for controlled testing in production.
  allowTransferToAi: bool(process.env.ALLOW_TRANSFER_TO_AI, false),

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
    verifyToken: process.env.FB_WEBHOOK_VERIFY_TOKEN || '', // GET handshake for the Messenger webhook
    appSecret: process.env.FB_APP_SECRET || '', // verifies X-Hub-Signature-256 on inbound Messenger POSTs
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
    // "Post now" pushes immediate posts to the same "Post to n8n" webhook (its IF
    // branches on for_automation). Same endpoint, so this falls back to the
    // generate URL unless split out via N8N_POST_WEBHOOK_URL.
    postWebhookUrl: process.env.N8N_POST_WEBHOOK_URL || process.env.N8N_GENERATE_WEBHOOK_URL || '',
    webhookToken: process.env.N8N_WEBHOOK_TOKEN || '', // optional: sent as x-service-token
    // Where Creatomate (via the render-complete workflow webhook) reports a finished
    // render. We hand this to n8n → Creatomate's `webhook_url` so the render can call
    // back asynchronously. Defaults to the same n8n instance as the generate webhook,
    // swapping the path to /webhook/creatomate-render-complete; override only if the
    // render-complete listener lives elsewhere.
    renderCompleteWebhookUrl:
      process.env.N8N_RENDER_COMPLETE_WEBHOOK_URL ||
      (process.env.N8N_GENERATE_WEBHOOK_URL
        ? `${process.env.N8N_GENERATE_WEBHOOK_URL.split('/webhook/')[0]}/webhook/creatomate-render-complete`
        : ''),
    // The platform gateway forwards normalized inbound customer messages here for AI.
    aiWebhookUrl: process.env.N8N_AI_WEBHOOK_URL || '',
    aiSecret: process.env.N8N_AI_SECRET || '', // optional shared secret sent as x-gateway-secret
    // Dev Wise Assistant overlay -> server -> n8n assistant webhook.
    wiseAssistantWebhookUrl: process.env.N8N_WISE_ASSISTANT_WEBHOOK_URL || '',
    wiseAssistantSecret: process.env.N8N_WISE_ASSISTANT_SECRET || '',
  },

  // At-rest encryption key for connected-page credentials (platform_accounts).
  // 64 hex chars: `openssl rand -hex 32`.
  encryptionKey: process.env.ENCRYPTION_KEY || '',

  // SMTP for transactional email (the password-change verification code). When
  // unset, the change-password flow can't email — in dev it logs the code to
  // the server console; in production it returns 503.
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    secure: bool(process.env.SMTP_SECURE, false), // true for port 465
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || process.env.SMTP_USER || '',
  },
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
  if (!env.n8n.wiseAssistantWebhookUrl && env.nodeEnv === 'development') {
    warnings.push('N8N_WISE_ASSISTANT_WEBHOOK_URL is not set — the dev Wise Assistant chat will return 503.');
  }
  if (!env.encryptionKey) warnings.push('ENCRYPTION_KEY is not set — adding/using connected Facebook pages will fail (503).');
  if (!env.smtp.host) warnings.push('SMTP_HOST is not set — password-change codes are logged to the console in dev and fail (503) in production.');
  for (const w of warnings) logger.warn(`[env] ${w}`);
  return warnings;
}

export default env;
