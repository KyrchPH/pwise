import { Router } from 'express';
import * as ctrl from '../controllers/webhooks.controller.js';

// Public inbound webhooks from messaging platforms. No JWT: Telegram is verified via its
// secret_token header; the Meta products (Messenger, Instagram, WhatsApp) verify via the
// GET hub.challenge handshake (metaVerify) + the X-Hub-Signature-256 over the raw body.
// Each Meta product gets its own callback URL so it can be pasted per-product in the
// dashboard; all three share the same verify token + app secret (one Meta app).
const router = Router();

router.post('/telegram', ctrl.telegram);

router.get('/messenger', ctrl.metaVerify); // verification handshake
router.post('/messenger', ctrl.messenger); // all subscribed pages' inbound messages

router.get('/instagram', ctrl.metaVerify);
router.post('/instagram', ctrl.instagram);

router.get('/whatsapp', ctrl.metaVerify);
router.post('/whatsapp', ctrl.whatsapp);

export default router;
