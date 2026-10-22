import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as controller from '../controllers/verification.controller';
const router = Router();

router.use(authenticate, requireRole('GOVERNMENT', 'ADMIN'));
router.get('/queue', controller.getVerificationQueue);
router.get('/:requestId', controller.getVerificationDetail);
router.post('/:requestId/approve', controller.approveVerification);
router.post('/:requestId/reject', controller.rejectVerification);

export default router;
