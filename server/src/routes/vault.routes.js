import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import requireAdmin from '../middleware/admin.middleware.js';
import * as ctrl from '../controllers/vault.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list); // the whole tree (private folders filtered per user)
router.post('/folder', ctrl.createFolder); // create a folder (admins may set a restriction)
router.post('/file', ctrl.createFile); // record a file already uploaded to S3
router.get('/:id/access', requireAdmin, ctrl.getAccess); // read a folder's visibility + allow-list (admin)
router.patch('/:id/access', requireAdmin, ctrl.setAccess); // set a folder's visibility + allow-list (admin)
router.patch('/:id/move', ctrl.move); // move a file/folder into another folder
router.patch('/:id/ai-visibility', ctrl.setAiVisibility); // toggle "Hide from AI" on a file
router.patch('/:id/meta', ctrl.updateMeta); // edit a file's description + tags (AI metadata)
router.delete('/:id', ctrl.remove); // delete a file, or a folder + its contents

export default router;
