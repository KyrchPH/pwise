import crypto from 'node:crypto';
import { env } from '../config/env.js';
import ApiError from '../utils/ApiError.js';

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Machine auth for n8n -> /api/scheduler/*. Expects the shared service token in
// the `x-service-token` header (legacy `x-scheduler-secret` also accepted).
export function requireServiceToken(req, res, next) {
  if (!env.serviceToken) {
    return next(new ApiError(503, 'service endpoints disabled: SERVICE_TOKEN not configured'));
  }
  const provided = req.headers['x-service-token'] || req.headers['x-scheduler-secret'];
  if (!provided || !safeEqual(provided, env.serviceToken)) {
    return next(ApiError.unauthorized('invalid service token'));
  }
  next();
}

export default requireServiceToken;
