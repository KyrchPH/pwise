import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireMessagingAccess from '../middleware/messaging_access.middleware.js';
import * as ctrl from '../controllers/message_templates.controller.js';

// Per-page canned replies, managed from the Messaging → Templates section. Gated to
// users with Messaging access (same as the inbox); page scope rides accountId.
const router = Router();
router.use(requireAuth);
router.use(requireMessagingAccess);

router.get('/', ctrl.list); // ?accountId=
router.post('/', ctrl.create); // { accountId, title, body, tags }
router.post('/:id/duplicate', ctrl.duplicate); // { accountId }
router.patch('/:id', ctrl.update); // { accountId, title?, body?, tags? }
router.delete('/:id', ctrl.remove); // ?accountId=

export default router;
