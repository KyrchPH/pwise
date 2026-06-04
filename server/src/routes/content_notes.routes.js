import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/content_notes.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list); // ?date=YYYY-MM-DD — notes for one day
router.get('/month', ctrl.month); // ?year=&month= — per-day counts for the calendar
router.post('/', ctrl.create);
router.patch('/:id/status', ctrl.setStatus); // tag a note (status change)
router.patch('/:id/date', ctrl.setDate); // move a note to another day (drag-drop)
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
