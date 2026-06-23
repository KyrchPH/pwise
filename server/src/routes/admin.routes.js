import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireAdmin from '../middleware/admin.middleware.js';
import * as ctrl from '../controllers/admin.controller.js';

const router = Router();

// Every admin route requires an authenticated admin.
router.use(requireAuth, requireAdmin);

router.post('/invites', ctrl.createInvite);
router.get('/invites', ctrl.listInvites);
router.delete('/invites/:id', ctrl.deleteInvite);
router.get('/users', ctrl.listUsers);
router.patch('/users/:id', ctrl.setActive); // { is_active: boolean }
router.patch('/users/:id/access', ctrl.setModuleAccess); // { modules: string[] }
router.delete('/users/:id', ctrl.softDelete);

export default router;
