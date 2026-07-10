import ApiError from '../utils/ApiError.js';
import { isAdminRole } from '../config/modules.js';

// Must run after requireAuth (which sets req.user with the DB role).
export function requireAdmin(req, res, next) {
  if (!isAdminRole(req.user?.role)) return next(ApiError.forbidden('admin access required'));
  next();
}

export default requireAdmin;
