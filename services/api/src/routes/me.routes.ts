import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as controller from '../controllers/me.controller';
const router = Router();

router.use(authenticate);
router.get('/stats', controller.getStats);
router.get('/properties', controller.getProperties);
router.get('/transfers', controller.getTransfers);
router.get('/documents', controller.getDocuments);
router.put('/profile', controller.updateProfile);
router.put('/change-password', controller.changePassword);

export default router;
