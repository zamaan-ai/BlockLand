import { Router } from 'express';
import * as controller from '../controllers/builders.controller';
const router = Router();

router.get('/', controller.listBuilders);
router.get('/:username', controller.getBuilderByUsername);

export default router;
