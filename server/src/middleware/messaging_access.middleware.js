import ApiError from '../utils/ApiError.js';
import { hasMessagingAccess, canUseModule } from '../config/modules.js';

// Factory: gate a route to users with a given module (admins always pass). Runs
// AFTER requireAuth (relies on req.user).
export function requireModule(moduleId) {
  return (req, res, next) => {
    if (!canUseModule(req.user, moduleId)) return next(new ApiError(403, 'You do not have access to this feature.'));
    next();
  };
}

// Gate a route to users who can use Messaging — admins always pass; everyone else
// needs the 'messages' module. Runs AFTER requireAuth (relies on req.user). The
// service layer already filters teammates/participants to messaging-capable users,
// so this just stops a non-messaging account from touching the endpoints at all.
export function requireMessagingAccess(req, res, next) {
  if (!hasMessagingAccess(req.user)) return next(new ApiError(403, 'You do not have access to messaging.'));
  next();
}

export default requireMessagingAccess;
