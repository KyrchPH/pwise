import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/surveys.controller.js';

// Team-facing survey aggregates (Insights → Messaging). Plain auth like the other
// analytics endpoints — the data is day-lagged and anonymized at the service layer.
const router = Router();
router.use(requireAuth);

router.get('/summary', ctrl.summary); // ?range=<days> — active-page survey aggregates

export default router;
