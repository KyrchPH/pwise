import { env } from '../config/env.js';

// 404 for any unmatched route.
export function notFound(req, res) {
  res.status(404).json({ success: false, message: 'Not found' });
}

// Central error handler. ApiError carries a statusCode; everything else is 500.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const status = err.statusCode || 500;
  if (status >= 500) console.error('[error]', err);

  const body = { success: false, message: err.message || 'Internal server error' };
  if (err.details) body.details = err.details;
  if (env.nodeEnv !== 'production' && status >= 500) body.stack = err.stack;

  res.status(status).json(body);
}
