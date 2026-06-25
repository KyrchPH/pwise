import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireAdmin from '../middleware/admin.middleware.js';
import * as ctrl from '../controllers/platform_accounts.controller.js';
import * as fbctrl from '../controllers/fb_oauth.controller.js';

const router = Router();
router.use(requireAuth);

// Read + switch — any signed-in user.
router.get('/', ctrl.list);
router.get('/active', ctrl.active);
router.get('/health', ctrl.health); // per-page connection health (app-start check)
router.get('/:id/stats', ctrl.stats);
router.post('/select', ctrl.select);
// Sync display name/followers from Facebook; only touches account_name, so it's
// not gated to admins like the credential writes below.
router.post('/refresh', ctrl.refresh);

// Manage credentials — admins only.
router.post('/test', requireAdmin, ctrl.test);
// Built-in default agent prompts for the connect/new-page editor.
router.get('/ai-defaults', requireAdmin, ctrl.aiDefaults);
router.post('/', requireAdmin, ctrl.create);
router.patch('/:id', requireAdmin, ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);
// Per-agent AI system prompts for the page settings editor.
router.get('/:id/ai-config', requireAdmin, ctrl.aiConfig);
// Re-register this page's inbound webhooks with the platforms (no credential change).
router.post('/:id/refresh-webhook', requireAdmin, ctrl.refreshWebhook);

// "Connect with Facebook" OAuth import (admin). The /facebook/callback half is PUBLIC
// and mounted separately (fb_oauth.routes) since the browser redirect carries no JWT.
router.post('/facebook/oauth-url', requireAdmin, fbctrl.oauthUrl); // -> dialog URL
router.get('/facebook/discovered', requireAdmin, fbctrl.discovered); // staged pages for the picker
router.post('/facebook/import', requireAdmin, fbctrl.importPages); // import selected pages

export default router;
