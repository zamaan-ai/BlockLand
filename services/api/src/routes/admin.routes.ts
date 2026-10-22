import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as adminController from '../controllers/admin.controller';
const router = Router();

router.use(authenticate, requireRole('ADMIN'));
router.get('/stats', adminController.getStats);
router.get('/audit-logs', adminController.getAuditLogs);
router.get('/users', adminController.getUsers);
router.get('/role-requests', adminController.getPendingRoleRequests);
router.get('/system-health', adminController.getSystemHealth);
router.post('/users/:userId/roles', adminController.grantRole);
router.post('/officers', adminController.createOfficer);
router.delete('/role-assignments/:assignmentId', adminController.revokeRole);
router.patch('/users/:userId/status', adminController.setUserActive);
router.post('/legal-corrections', adminController.recordLegalCorrection);

export default router;
