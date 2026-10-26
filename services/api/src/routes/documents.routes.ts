import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { uploadSingle } from '../middleware/upload';
import * as controller from '../controllers/documents.controller';
const router = Router();

router.use(authenticate);
router.post('/upload', uploadSingle('file'), controller.uploadDocument);
router.get('/my', controller.listMyDocuments);
router.get('/:docId', controller.getDocumentMetadata);
router.delete('/:docId', controller.deleteDocument);

export default router;
