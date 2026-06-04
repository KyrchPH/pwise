import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/creatomate.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
