import prisma from './prisma';
import { logAction } from './auditLogger';
import { emitTransferUpdate } from './socketEvents';
import { getSocketServer } from './socket';

export async function expireTransfers() {
  const now = new Date();
  const expired = await prisma.transfer.findMany({
    where: { status: { in: ['LOCKED', 'ESCROW_FUNDED', 'UNDER_REVIEW'] }, lockExpiresAt: { lt: now } },
    select: {
      id: true, landId: true, fromUserId: true,
      land: { select: { disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } }, select: { id: true } }, encumbrances: { where: { active: true }, select: { id: true } } } },
    },
  });
  for (const transfer of expired) {
    const restoredStatus = transfer.land.disputes.length ? 'DISPUTED' : transfer.land.encumbrances.length ? 'MORTGAGED' : 'VERIFIED';
    await prisma.$transaction(async tx => {
      await tx.transfer.update({ where: { id: transfer.id }, data: { status: 'REFUNDED', rejectionReason: 'Transfer lock expired' } });
      await tx.land.update({ where: { id: transfer.landId }, data: { status: restoredStatus, lockTransferId: null } });
      await tx.escrowAccount.updateMany({ where: { transferId: transfer.id, status: { in: ['PENDING', 'FUNDED'] } }, data: { status: 'REFUNDED', refundedAt: now, refundReference: `expiry-refund-${transfer.id}` } });
      await tx.notification.create({ data: { userId: transfer.fromUserId, type: 'TRANSFER_EXPIRED', title: 'Transfer expired', message: `Transfer ${transfer.id} expired and the plot was unlocked.` } });
    });
    await logAction('TRANSFER_EXPIRED', null, 'Transfer', transfer.id);
    emitTransferUpdate(getSocketServer(), transfer.id, 'REFUNDED');
  }
  return expired.length;
}
