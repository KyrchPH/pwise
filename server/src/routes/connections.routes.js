import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import { requireModule } from '../middleware/messaging_access.middleware.js';
import * as ctrl from '../controllers/connections.controller.js';

// Agent-to-agent connections ("friends"). Gated by the 'connections' module.
const router = Router();

router.use(requireAuth);
router.use(requireModule('connections'));

router.get('/', ctrl.list); // { connections, incoming, outgoing }
router.get('/search', ctrl.search);
router.post('/request', ctrl.request); // body { userId }
router.post('/:userId/accept', ctrl.accept);
router.post('/:userId/decline', ctrl.decline);
router.post('/:userId/cancel', ctrl.cancel);
router.delete('/:userId', ctrl.remove);

export default router;
