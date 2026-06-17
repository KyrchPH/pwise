import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/messaging.controller.js';

const router = Router();

// SSE stream authenticates via ?token= (EventSource can't set headers), so it
// is declared before the blanket requireAuth below.
router.get('/stream', ctrl.stream);

router.use(requireAuth);
router.get('/', ctrl.list); // all conversations (shared inbox)
router.get('/:id', ctrl.get); // one thread with its messages
router.post('/:id/messages', ctrl.send); // send a reply (media + text split into bubbles)
router.post('/:id/seen', ctrl.seen); // mark thread seen (clears unread)
router.post('/:id/takeover', ctrl.takeover); // AI Agent → Live Agent

export default router;
