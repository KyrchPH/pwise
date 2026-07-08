import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/analytics.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/overview', ctrl.overview); // ?range=<days>
router.get('/insights', ctrl.insights); // ?range=<days> — Performance card model

export default router;
