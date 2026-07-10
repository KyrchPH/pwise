import { Router } from 'express';
import * as ctrl from '../controllers/surveys.controller.js';

// Public, unauthenticated customer survey endpoints. No JWT — the unguessable 40-char
// token from the survey email is the capability (same model as public_agreements).
// Mounted before the authed routers in app.js so it isn't gated.
const router = Router();

router.get('/:token', ctrl.publicGet); // fetch the survey shell (or its end-state)
router.post('/:token/respond', ctrl.publicRespond); // one-shot answer submit

export default router;
