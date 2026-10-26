import { Router } from 'express';
import { authenticate, optionalAuth } from '../middleware/auth';
import * as landsController from '../controllers/lands.controller';
const router = Router();

router.get('/', optionalAuth, landsController.listLands);
router.get('/search', optionalAuth, landsController.searchLands);
router.get('/:plotId', optionalAuth, landsController.getLand);
router.post('/', authenticate, landsController.registerLand);

export default router;
