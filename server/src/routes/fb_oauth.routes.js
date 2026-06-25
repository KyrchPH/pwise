import { Router } from 'express';
import * as ctrl from '../controllers/fb_oauth.controller.js';

// PUBLIC Facebook OAuth callback. Facebook redirects the browser here after the user
// authorizes "Connect with Facebook" — it carries no JWT (top-level navigation), so it
// can't live behind requireAuth; the signed `state` carries + verifies the user. This
// router is mounted at /api/pages/facebook BEFORE the authed /api/pages router so the
// callback isn't gated; the oauth-url / discovered / import endpoints stay admin-only
// on the main pages router.
const router = Router();

router.get('/callback', ctrl.callback);

export default router;
