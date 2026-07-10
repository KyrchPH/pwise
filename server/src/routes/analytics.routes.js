import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/analytics.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/overview', ctrl.overview); // ?range=<days>
router.get('/all-pages-metrics', ctrl.allPagesMetrics); // ?range=<days> - all connected pages report table
router.get('/insights', ctrl.insights); // ?range=<days> - Performance card model
router.get('/highlights', ctrl.highlights); // ?range=<days> - Insights "Overview" digest
router.get('/messaging', ctrl.messaging); // ?range=<days> - Messaging "Contacts" model
router.get('/contents', ctrl.contents); // ?range=<days> - Contents performance table

export default router;
