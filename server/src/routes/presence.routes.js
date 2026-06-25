import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/presence.controller.js';

const router = Router();

// App-wide agent presence — any logged-in user (not messaging-only). The heartbeat
// keeps them "online" for order routing; offline is sent when their tab goes idle.
router.use(requireAuth);
router.post('/ping', ctrl.ping);
router.post('/offline', ctrl.offline);
router.get('/status', ctrl.status); // presence for all active users (for avatar badges)

export default router;
