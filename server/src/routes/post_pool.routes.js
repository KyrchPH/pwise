import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/post_pool.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.get('/counts', ctrl.counts); // before /:id so it isn't captured as an id
router.get('/slot', ctrl.checkSlot); // before /:id; pre-flight slot availability
router.get('/:id', ctrl.get);
router.get('/:id/comments', ctrl.comments); // live Facebook comments (paged / lazy)
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
