import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/stories.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list);
router.get('/:id', ctrl.getOne);
router.get('/:id/insights', ctrl.insights); // live per-story metrics (view page)
router.post('/', ctrl.create);
router.post('/:id/retry', ctrl.retry); // re-run a failed story's publish flow
router.delete('/:id', ctrl.remove);

export default router;
