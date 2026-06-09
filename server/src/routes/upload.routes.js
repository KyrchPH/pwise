import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/upload.controller.js';

const router = Router();

router.use(requireAuth);
router.post('/presigned-url', ctrl.presignedUrl);
router.post('/confirm', ctrl.confirm);
router.post('/discard', ctrl.discard);

export default router;
