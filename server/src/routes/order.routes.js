import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/order.controller.js';

const router = Router();

// SSE stream authenticates via ?token= (EventSource can't set headers), so it is
// declared before the blanket requireAuth below.
router.get('/agreements/:id/stream', ctrl.stream);

router.use(requireAuth);

// Agreements (checkout) — declared before the /:id order routes so they aren't swallowed.
router.post('/agreements', ctrl.createAgreement);
router.get('/agreements/:id', ctrl.getAgreement);
router.post('/agreements/:id/email', ctrl.emailAgreement);

// Orders (owner-scoped list; admins may pass ?ownerId to filter by processor).
router.get('/', ctrl.listOrders);
router.get('/:id', ctrl.getOrder);
router.patch('/:id/status', ctrl.updateOrderStatus);

export default router;
