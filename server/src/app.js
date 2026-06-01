import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { notFound, errorHandler } from './middleware/error.middleware.js';
import authRoutes from './routes/auth.routes.js';
import postPoolRoutes from './routes/post_pool.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import logsRoutes from './routes/logs.routes.js';
import schedulerRoutes from './routes/scheduler.routes.js';

/**
 * Builds the Express application: a data/auth/upload API for the frontend,
 * plus machine endpoints (/api/scheduler/*) for the n8n autoposting workflow.
 */
export function createApp() {
  const app = express();

  app.use(cors({ origin: env.clientUrl, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  // Health checks (root for load balancers, /api for the client dev proxy).
  const health = (req, res) =>
    res.json({ status: 'ok', service: 'auto-post-agent server', timestamp: new Date().toISOString() });
  app.get('/health', health);
  app.get('/api/health', health);

  // Frontend-facing (JWT) routes.
  app.use('/api/auth', authRoutes);
  app.use('/api/post-pool', postPoolRoutes);
  app.use('/api/upload', uploadRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/logs', logsRoutes);

  // Machine-facing (service-token) routes for n8n.
  app.use('/api/scheduler', schedulerRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
