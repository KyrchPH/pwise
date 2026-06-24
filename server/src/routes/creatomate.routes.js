import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireServiceToken from '../middleware/service_token.middleware.js';
import * as ctrl from '../controllers/creatomate.controller.js';

const router = Router();

// Machine-only (service token, not JWT): the n8n render-complete webhook reports
// a finished render here. Declared before the blanket requireAuth so it uses its
// own auth, like the messaging inbound/handoff routes.
router.post('/renders/callback', requireServiceToken, ctrl.renderCallback);

router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/', ctrl.create);

// Render endpoints (declared before '/:id' so 'renders' isn't read as an id).
router.post('/renders', ctrl.startRender); // kick off n8n render → { renderJobId }
router.post('/renders/save', ctrl.saveRender); // download the output into S3
router.get('/renders/:id', ctrl.renderStatus); // poll a render job's state

router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
