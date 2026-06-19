import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireMessagingAccess from '../middleware/messaging_access.middleware.js';
import * as ctrl from '../controllers/team.controller.js';

// Agent-to-agent chat. Routes require a logged-in user (JWT) WITH Messaging access;
// per-conversation participation is enforced in the service. Real-time updates flow
// over the shared messaging SSE stream (/api/messages/stream) as team:* events.
const router = Router();

router.use(requireAuth);
router.use(requireMessagingAccess);

router.get('/agents', ctrl.agents); // teammate search (start a chat / add members)
router.get('/conversations', ctrl.list);
router.post('/conversations', ctrl.create); // DM (reused if it exists) or group
router.get('/conversations/:id', ctrl.get);
router.post('/conversations/:id/messages', ctrl.send);
router.post('/conversations/:id/seen', ctrl.seen);
router.patch('/conversations/:id', ctrl.rename); // group rename
router.post('/conversations/:id/participants', ctrl.addMembers);
router.delete('/conversations/:id/participants/:userId', ctrl.removeMember);
router.post('/conversations/:id/leave', ctrl.leave);

export default router;
