import { Router } from 'express';
import * as ctrl from '../controllers/webhooks.controller.js';

// Public inbound webhooks from messaging platforms. No JWT: Telegram is verified via
// its secret_token header; a future Messenger adapter verifies via the FB signature.
const router = Router();

router.post('/telegram', ctrl.telegram);
router.get('/messenger', ctrl.messengerVerify); // FB webhook verification handshake
router.post('/messenger', ctrl.messenger); // all subscribed pages' inbound messages

export default router;
