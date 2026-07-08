import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/content_notes.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list); // ?date=YYYY-MM-DD — notes for one day
router.get('/month', ctrl.month); // ?year=&month= — per-day counts for the calendar
router.post('/', ctrl.create);
router.patch('/reorder', ctrl.reorder); // re-rank a day's notes — MUST precede '/:id'
router.patch('/:id/status', ctrl.setStatus); // tag a note (status change)
router.patch('/:id/date', ctrl.setDate); // move a note to another day (drag-drop)
router.patch('/:id/page', ctrl.setPage); // re-tag a note's owning page
router.patch('/:id/color', ctrl.setColor); // recolour a note (text / background)
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
