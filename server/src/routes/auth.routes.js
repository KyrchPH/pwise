import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/auth.controller.js';

const router = Router();

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.get('/me', requireAuth, ctrl.me);
router.post('/logout', requireAuth, ctrl.logout);

export default router;
