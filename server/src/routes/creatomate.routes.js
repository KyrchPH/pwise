import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/creatomate.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list);
router.post('/', ctrl.create);

// Render endpoints (declared before '/:id' so 'renders' isn't read as an id).
router.post('/renders', ctrl.startRender); // trigger n8n render → { url }
router.post('/renders/save', ctrl.saveRender); // download the output into S3

router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
