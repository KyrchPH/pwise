import { Router } from 'express';
import requireAuth from '../middleware/auth.middleware.js';
import * as ctrl from '../controllers/vault.controller.js';

const router = Router();

router.use(requireAuth);
router.get('/', ctrl.list); // the whole tree (shared)
router.post('/folder', ctrl.createFolder); // create a folder
router.post('/file', ctrl.createFile); // record a file already uploaded to S3
router.patch('/:id/move', ctrl.move); // move a file/folder into another folder
router.delete('/:id', ctrl.remove); // delete a file, or a folder + its contents

export default router;
