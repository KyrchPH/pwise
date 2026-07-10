import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireAdmin from '../middleware/admin.middleware.js';
import * as ctrl from '../controllers/surveys.controller.js';

// Team-facing survey aggregates (Insights → Messaging). Plain auth like the other
// analytics endpoints — the data is day-lagged and anonymized at the service layer.
const router = Router();
router.use(requireAuth);

router.get('/summary', ctrl.summary); // ?range=<days> — active-page survey aggregates

// "Send test survey" (Settings → Customer surveys) — admins only, matching the guard
// on the survey_config write (PATCH /platform-accounts/:id). The test is observable
// and excluded from analytics (is_test), so it's safe to expose its live status.
router.post('/test', requireAdmin, ctrl.sendTest); // send a test to a chosen email
router.get('/test', requireAdmin, ctrl.testStatus); // latest test's live status

export default router;
