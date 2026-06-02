import ApiError from '../utils/ApiError.js';

// Must run after requireAuth (which sets req.user with the DB role).
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return next(ApiError.forbidden('admin access required'));
  next();
}

export default requireAdmin;
