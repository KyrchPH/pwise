import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireAdmin from '../middleware/admin.middleware.js';
import * as ctrl from '../controllers/page_discounts.controller.js';

// Per-page discount rules. Reads remain available to authenticated users; writes are
// admin-only (mirrors page_products).
const router = Router();
router.use(requireAuth);

router.get('/', ctrl.list); // ?accountId= — discounts for a page
router.post('/', requireAdmin, ctrl.create);
router.patch('/:id', requireAdmin, ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);

export default router;
