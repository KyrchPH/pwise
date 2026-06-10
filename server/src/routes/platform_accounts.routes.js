import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireAdmin from '../middleware/admin.middleware.js';
import * as ctrl from '../controllers/platform_accounts.controller.js';

const router = Router();
router.use(requireAuth);

// Read + switch — any signed-in user.
router.get('/', ctrl.list);
router.get('/active', ctrl.active);
router.get('/:id/stats', ctrl.stats);
router.post('/select', ctrl.select);
// Sync display name/followers from Facebook; only touches account_name, so it's
// not gated to admins like the credential writes below.
router.post('/refresh', ctrl.refresh);

// Manage credentials — admins only.
router.post('/test', requireAdmin, ctrl.test);
router.post('/', requireAdmin, ctrl.create);
router.patch('/:id', requireAdmin, ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);

export default router;
