import { resolveSession } from '../services/auth.service.js';
import ApiError from '../utils/ApiError.js';

// Verifies the Bearer JWT, loads the user (so deactivated/deleted accounts are rejected
// immediately), AND checks the token's session is still active — so "log out of this /
// other devices" takes effect. Sets req.user and req.sessionId.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(ApiError.unauthorized('missing bearer token'));

  resolveSession(token)
    .then((result) => {
      if (!result) return next(ApiError.unauthorized('your session is no longer valid — please log in again'));
      // Wise Assistant tokens are strictly read-only: the assistant may look up the
      // user's data through the API, but can never mutate anything with it.
      if (result.scope === 'wise_assistant' && req.method !== 'GET' && req.method !== 'HEAD') {
        return next(ApiError.forbidden('the Wise Assistant token is read-only'));
      }
      req.user = result.user;
      req.sessionId = result.sessionId;
      req.authScope = result.scope;
      next();
    })
    .catch((err) => {
      // A JWT verify error (malformed/expired) → 401; a real error (e.g. DB) → forward.
      if (err && /^(JsonWebTokenError|TokenExpiredError|NotBeforeError)$/.test(err.name || '')) {
        return next(ApiError.unauthorized('invalid or expired token'));
      }
      next(err);
    });
}

export default requireAuth;
