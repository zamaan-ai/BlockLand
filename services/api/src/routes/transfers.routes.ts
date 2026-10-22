import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth';
import * as controller from '../controllers/transfers.controller';
const router = Router();

router.use(authenticate);
router.post('/prepare', requireRole('LANDOWNER', 'USER'), controller.prepareTransfer);
router.post('/', requireRole('LANDOWNER', 'USER'), controller.initiateTransfer);
router.get('/', controller.listTransfers);
router.get('/:transferId', controller.getTransferDetail);

router.post('/:transferId/escrow/fund', controller.fundEscrow);
router.patch('/:transferId/cancel', requireRole('LANDOWNER', 'USER'), controller.cancelTransfer);
router.post('/:transferId/approve', requireRole('GOVERNMENT', 'ADMIN'), controller.approveTransfer);
router.post('/:transferId/reject', requireRole('GOVERNMENT', 'ADMIN'), controller.rejectTransfer);

export default router;
