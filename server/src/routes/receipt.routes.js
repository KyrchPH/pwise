import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/receipt.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list); // the caller's own receipts (admins: all, or ?ownerId=)
router.post('/', ctrl.create); // record a file already uploaded to S3 (receipts/ prefix)
router.get('/:id/download', ctrl.download); // fresh presigned URL for one receipt
router.delete('/:id', ctrl.remove); // delete a receipt (owner/admin) + its S3 object

export default router;
