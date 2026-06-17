import { verifyToken, findActiveById } from '../services/auth.service.js';
import ApiError from '../utils/ApiError.js';

// Verifies the Bearer JWT, then loads the user from the DB so deactivated /
// deleted accounts are rejected immediately (their existing token stops working).
// Sets req.user = { id, name, email, role, is_active, module_access }.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized('missing bearer token'));

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    return next(ApiError.unauthorized('invalid or expired token'));
  }

  findActiveById(payload.sub)
    .then((user) => {
      if (!user) return next(ApiError.unauthorized('account not found or inactive'));
      req.user = user;
      next();
    })
    .catch(next); // forward real errors (e.g. DB) instead of masking as 401
}

export default requireAuth;
