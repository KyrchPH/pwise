import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { notFound, errorHandler } from './middleware/error.middleware.js';
import revalidate from './middleware/cache.middleware.js';
import authRoutes from './routes/auth.routes.js';
import postPoolRoutes from './routes/post_pool.routes.js';
import storiesRoutes from './routes/stories.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import logsRoutes from './routes/logs.routes.js';
import schedulerRoutes from './routes/scheduler.routes.js';
import presenceRoutes from './routes/presence.routes.js';
import adminRoutes from './routes/admin.routes.js';
import activityRoutes from './routes/activity.routes.js';
import contentNotesRoutes from './routes/content_notes.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import creatomateRoutes from './routes/creatomate.routes.js';
import platformAccountsRoutes from './routes/platform_accounts.routes.js';
import fbOauthRoutes from './routes/fb_oauth.routes.js';
import pageProductsRoutes from './routes/page_products.routes.js';
import pageDiscountsRoutes from './routes/page_discounts.routes.js';
import messagingRoutes from './routes/messaging.routes.js';
import messageTemplatesRoutes from './routes/message_templates.routes.js';
import conversationNotesRoutes from './routes/conversation_notes.routes.js';
import teamRoutes from './routes/team.routes.js';
import connectionsRoutes from './routes/connections.routes.js';
import webhooksRoutes from './routes/webhooks.routes.js';
import vaultRoutes from './routes/vault.routes.js';
import wiseAssistantRoutes from './routes/wise_assistant.routes.js';
import plannerRoutes from './routes/planner.routes.js';
import orderRoutes from './routes/order.routes.js';
import receiptRoutes from './routes/receipt.routes.js';
import publicAgreementRoutes from './routes/public_agreements.routes.js';
import publicSurveyRoutes from './routes/public_surveys.routes.js';
import surveysRoutes from './routes/surveys.routes.js';

/**
 * Builds the Express application: a data/auth/upload API for the frontend,
 * plus machine endpoints (/api/scheduler/*) for the n8n autoposting workflow.
 */
export function createApp() {
  const app = express();

  app.use(cors({ origin: env.clientUrl, credentials: true }));
  // Keep the raw body around so the Messenger webhook can verify FB's signature.
  app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

  // Health checks (root for load balancers, /api for the client dev proxy).
  const health = (req, res) =>
    res.json({ status: 'ok', service: 'auto-post-agent server', timestamp: new Date().toISOString() });
  app.get('/health', health);
  app.get('/api/health', health);

  // Frontend-facing (JWT) routes. `revalidate` lets the browser cache GETs and
  // revalidate via ETag (304) — see cache.middleware.js. Applied to read-heavy
  // routes only; auth + upload are left uncached.
  app.use('/api/auth', authRoutes);
  app.use('/api/post-pool', revalidate, postPoolRoutes);
  // Contents → Stories (24h Facebook/Instagram stories). The client re-polls while
  // a story is publishing, so the ETag revalidate keeps those polls cheap.
  app.use('/api/stories', revalidate, storiesRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/settings', revalidate, settingsRoutes);
  app.use('/api/logs', revalidate, logsRoutes);
  app.use('/api/admin', revalidate, adminRoutes);
  app.use('/api/activity', revalidate, activityRoutes);
  app.use('/api/content-notes', revalidate, contentNotesRoutes);
  app.use('/api/analytics', revalidate, analyticsRoutes);
  app.use('/api/creatomate-templates', revalidate, creatomateRoutes);
  // Public Facebook OAuth callback (browser redirect, no JWT) — MUST be mounted
  // before the authed /api/pages router so it isn't gated; the rest of the OAuth flow
  // (oauth-url / discovered / import) is admin-only inside platformAccountsRoutes.
  app.use('/api/pages/facebook', fbOauthRoutes);
  app.use('/api/pages', revalidate, platformAccountsRoutes);
  app.use('/api/page-products', revalidate, pageProductsRoutes);
  app.use('/api/page-discounts', revalidate, pageDiscountsRoutes);
  // Public agreement viewer (customer opens a shared token link, no JWT) — MUST be mounted
  // before the authed /api/orders router so it isn't gated (mirrors the fb-oauth callback).
  app.use('/api/public/agreements', publicAgreementRoutes);
  // Public customer survey (opened from the survey email's token link, no JWT).
  app.use('/api/public/surveys', publicSurveyRoutes);
  // Team-facing survey aggregates — day-lagged reads, so browser revalidation is fine.
  app.use('/api/surveys', revalidate, surveysRoutes);
  // Shop → Orders + the checkout agreement flow. Real-time (SSE + confirm writes), uncached.
  app.use('/api/orders', orderRoutes);
  // Shop → Receipts carry rotating presigned URLs, so left uncached (like the vault).
  app.use('/api/receipts', receiptRoutes);
  // Messaging is real-time (SSE + frequent writes), so it's left uncached.
  app.use('/api/messages', messagingRoutes);
  // Per-page canned-reply templates (normal CRUD — cacheable like other page content).
  app.use('/api/message-templates', revalidate, messageTemplatesRoutes);
  // Per-conversation notes — real-time (SSE on create/delete), so left uncached.
  app.use('/api/conversation-notes', conversationNotesRoutes);
  // Agent-to-agent (internal team) chat — also real-time, uncached.
  app.use('/api/team', teamRoutes);
  // Agent-to-agent connections ("friends") — gates A2A DM replies.
  app.use('/api/connections', connectionsRoutes);
  app.use('/api/wise-assistant', wiseAssistantRoutes);
  // Planner goals — the list mutates status/baseline on read (reconcile-on-read),
  // so it's left uncached rather than served a stale ETag.
  app.use('/api/planner', plannerRoutes);

  // Public inbound webhooks from messaging platforms (Telegram now; Messenger later).
  // No JWT — each platform verifies itself; the page is tagged via ?accountId.
  app.use('/api/webhooks', webhooksRoutes);
  // Vault carries rotating presigned URLs + frequent writes — left uncached.
  app.use('/api/vault', vaultRoutes);

  // Machine-facing (service-token) routes for n8n.
  app.use('/api/scheduler', schedulerRoutes);
  // App-wide agent presence — heartbeat from the authed client (JWT, self-gated).
  app.use('/api/presence', presenceRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
