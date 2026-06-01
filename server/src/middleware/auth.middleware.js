import { verifyToken } from '../services/auth.service.js';
import ApiError from '../utils/ApiError.js';

// Verifies a `Authorization: Bearer <jwt>` header and sets req.user.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized('missing bearer token'));
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    next(ApiError.unauthorized('invalid or expired token'));
  }
}

export default requireAuth;
