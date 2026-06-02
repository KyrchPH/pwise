import { Router } from 'express';
import requireServiceToken from '../middleware/service_token.middleware.js';
import * as ctrl from '../controllers/scheduler.controller.js';

const router = Router();

// All scheduler routes are machine-only (called by n8n with the service token).
router.use(requireServiceToken);
router.post('/claim', ctrl.claim);
router.get('/pool-status', ctrl.poolStatus);
router.post('/posts/:id/posted', ctrl.markPosted);
router.post('/posts/:id/failed', ctrl.markFailed);
router.post('/settings/:id/alert-sent', ctrl.alertSent);
router.get('/engagement/pending', ctrl.engagementPending); // n8n: which posts to refresh
router.post('/posts/:id/engagement', ctrl.saveEngagement); // n8n: store pulled engagement

export default router;
