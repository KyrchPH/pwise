import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/logs.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list);
router.get('/:id', ctrl.get);

export default router;
