import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/stories.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.post('/:id/retry', ctrl.retry); // re-run a failed story's publish flow
router.delete('/:id', ctrl.remove);

export default router;
