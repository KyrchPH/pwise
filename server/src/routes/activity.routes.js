import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/activity.controller.js';

const router = Router();

// Signed-in users can view the shared post activity log.
router.use(requireAuth);
router.get('/', ctrl.list);

export default router;
