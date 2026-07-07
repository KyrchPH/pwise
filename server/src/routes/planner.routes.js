import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/planner.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/goals', ctrl.list);
router.post('/goals', ctrl.create);
router.get('/goals/:id', ctrl.get);
router.patch('/goals/:id', ctrl.update);
router.delete('/goals/:id', ctrl.remove);

export default router;
