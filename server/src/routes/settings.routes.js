import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/settings.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.get);
router.patch('/', ctrl.update);

export default router;
