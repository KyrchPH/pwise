import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/auth.controller.js';

const router = Router();

router.post('/register', ctrl.register); // requires a valid invite token in the body
router.post('/login', ctrl.login);
router.get('/invite/:token', ctrl.validateInvite); // public: check an invite link
router.get('/me', requireAuth, ctrl.me);
router.patch('/me', requireAuth, ctrl.updateMe);
router.patch('/me/avatar', requireAuth, ctrl.updateAvatar);
router.post('/logout', requireAuth, ctrl.logout); // revoke THIS session
router.post('/logout-all', requireAuth, ctrl.logoutAll); // revoke all OTHER sessions
router.get('/sessions', requireAuth, ctrl.sessions); // list this user's sessions
router.delete('/sessions/:id', requireAuth, ctrl.revokeSession); // log out a specific device

// Email-verified password change (signed-in user). 3 steps: confirm current
// password → verify emailed code → set new password.
router.post('/password/start', requireAuth, ctrl.startPasswordChange);
router.post('/password/verify', requireAuth, ctrl.verifyPasswordCode);
router.post('/password/complete', requireAuth, ctrl.completePasswordChange);

export default router;
