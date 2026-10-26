import { Router } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth';
import { requireRole } from '../middleware/auth';
import * as controller from '../controllers/projects.controller';
const router = Router();

router.get('/', optionalAuth, controller.listProjects);
router.get('/:projectId', optionalAuth, controller.getProjectDetail);
router.post('/', authenticate, requireRole('DEVELOPER', 'ADMIN'), controller.createProject);
router.put('/:projectId', authenticate, requireRole('DEVELOPER', 'ADMIN'), controller.updateProject);
router.delete('/:projectId', authenticate, requireRole('DEVELOPER', 'ADMIN'), controller.deleteProject);

export default router;
