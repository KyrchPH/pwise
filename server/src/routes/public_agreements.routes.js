import { Router } from 'express';
import * as ctrl from '../controllers/order.controller.js';

// Public, unauthenticated agreement viewer endpoints. No JWT — the unguessable 40-char
// token is the capability. Mounted before the authed routers in app.js (like the Facebook
// OAuth callback) so it isn't gated. The customer opens /agreement/:token in the SPA, which
// calls these to render the doc, heartbeat "viewing", and confirm the order.
const router = Router();

router.get('/:token', ctrl.publicGet); // fetch the agreement (or its closed end-state)
router.post('/:token/ping', ctrl.publicPing); // "still viewing" heartbeat → notifies staff
router.post('/:token/confirm', ctrl.publicConfirm); // tick + confirm → creates the order

export default router;
