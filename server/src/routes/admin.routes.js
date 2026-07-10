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
router.patch('/users/:id/role', ctrl.setRole); // { role: 'user' | 'admin' }
router.patch('/users/:id/super-admin', ctrl.transferSuperAdmin); // transfer super_admin role
router.patch('/users/:id/access', ctrl.setModuleAccess); // { modules: string[] }
router.patch('/users/:id/unlock', ctrl.unlockAccount); // clear a brute-force lockout
router.delete('/users/:id', ctrl.softDelete);

// Global automation pause switches (AI Agent / auto-posting).
router.get('/pause', ctrl.getPause);
router.patch('/pause', ctrl.setPause); // { aiPaused?, postingPaused? }

export default router;
