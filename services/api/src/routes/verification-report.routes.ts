import { Router } from 'express';
import { optionalAuth } from '../middleware/auth';
import * as controller from '../controllers/verification-report.controller';
import * as roleController from '../controllers/role-dashboard.controller';
const router = Router();
router.get('/:plotId/verify', optionalAuth, controller.getVerificationReport);
router.post('/:plotId/objections', optionalAuth, roleController.submitPublicObjection);
export default router;
