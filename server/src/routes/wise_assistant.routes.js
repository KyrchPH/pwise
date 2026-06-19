import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/wise_assistant.controller.js';

const router = Router();

router.use(requireAuth);
router.post('/ask', ctrl.ask);

export default router;
