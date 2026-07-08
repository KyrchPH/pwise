import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/post_pool.controller.js';

const router = Router();

// SSE stream authenticates via ?token= (EventSource can't set headers), so it is
// declared before the blanket requireAuth below — same pattern as /messages/stream.
router.get('/comments/stream', ctrl.commentStream);

router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/counts', ctrl.counts); // before /:id so it isn't captured as an id
router.get('/slot', ctrl.checkSlot); // before /:id; pre-flight slot availability
router.get('/comments/feed', ctrl.commentFeed); // before /:id; aggregated comments inbox
router.post('/comments/:commentId/status', ctrl.setCommentStatus); // mark a comment handled/open
router.get('/:id', ctrl.get);
router.get('/:id/comments', ctrl.comments); // live Facebook comments (paged / lazy)
router.post('/:id/comments/:commentId/reply', ctrl.replyComment); // reply to a comment as the page
router.post('/:id/comments/:commentId/message', ctrl.messageCommenter); // private-reply DM the commenter
router.get('/:id/insights', ctrl.insights); // per-day/month engagement series for the graph
router.patch('/:id', ctrl.update);
router.post('/:id/retry', ctrl.retry); // re-publish a failed/expired post now (immediate webhook)
router.delete('/:id', ctrl.remove);

export default router;
