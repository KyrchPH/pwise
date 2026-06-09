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

// Manage credentials — admins only.
router.post('/test', requireAdmin, ctrl.test);
router.post('/', requireAdmin, ctrl.create);
router.patch('/:id', requireAdmin, ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);

export default router;
