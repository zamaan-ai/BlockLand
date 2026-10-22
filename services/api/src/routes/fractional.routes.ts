import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import * as controller from '../controllers/fractional.controller';
const router = Router();

router.get('/land/:plotId', controller.getFractionalOwners);
router.use(authenticate);
router.post('/', controller.addFractionalShare);
router.put('/:id', controller.updateFractionalShare);
router.delete('/:id', controller.deleteFractionalShare);

export default router;
