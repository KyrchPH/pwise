import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/page_products.controller.js';

// Per-page products. JWT-only (any signed-in user); the client gates the Workspace
// nav/route by the `products` module.
const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list); // ?accountId= — products for a page
router.post('/', ctrl.create);
router.patch('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

export default router;
