import express from 'express';
import cors from 'cors';

/**
 * Builds and configures the Express application.
 * Routes are mounted here as later phases add them.
 */
export function createApp() {
  const app = express();

  app.use(
    cors({
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      credentials: true,
    }),
  );
  app.use(express.json());

  // Health checks. Root path is handy for load balancers/uptime monitors;
  // the /api variant is reachable through the client's dev proxy.
  const health = (req, res) =>
    res.json({
      status: 'ok',
      service: 'auto-post-agent server',
      timestamp: new Date().toISOString(),
    });
  app.get('/health', health);
  app.get('/api/health', health);

  // --- API routes (added in later phases) ---
  // app.use('/api/auth', authRoutes);
  // app.use('/api/post-pool', postPoolRoutes);
  // app.use('/api/upload', uploadRoutes);
  // app.use('/api/settings', settingsRoutes);
  // app.use('/api/scheduler', schedulerRoutes);
  // app.use('/api/logs', logsRoutes);

  // Fallback 404 for unmatched API routes.
  app.use('/api', (req, res) => {
    res.status(404).json({ success: false, message: 'Not found' });
  });

  // --- Error middleware (added in the server-foundation phase) ---
  // app.use(errorMiddleware);

  return app;
}

export default createApp;
