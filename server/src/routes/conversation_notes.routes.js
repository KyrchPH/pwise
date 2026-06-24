import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireMessagingAccess from '../middleware/messaging_access.middleware.js';
import requireAdmin from '../middleware/admin.middleware.js';
import * as ctrl from '../controllers/conversation_notes.controller.js';

// Per-conversation notes. All routes need Messaging access; creating is open to any
// such user, while deleting is admin-only. Notes are immutable, so there's no PATCH.
const router = Router();
router.use(requireAuth);
router.use(requireMessagingAccess);

router.get('/', ctrl.list); // ?conversationId=
router.post('/', ctrl.create); // { conversationId, body }
router.delete('/:id', requireAdmin, ctrl.remove);

export default router;
