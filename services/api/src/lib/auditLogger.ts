import prisma from './prisma';

export const logAction = async (
  action: string,
  actorId: string | null,
  targetType: string,
  targetId: string,
  details?: any,
  txHash?: string,
  ipAddress?: string
) => {
  try {
    let actorWallet = null;
    if (actorId) {
      const user = await prisma.user.findUnique({ where: { id: actorId }});
      if (user) actorWallet = user.walletAddress;
    }

    await prisma.auditLog.create({
      data: {
        action,
        actorId,
        actorWallet,
        targetType,
        targetId,
        details: details || {},
        txHash,
        ipAddress
      }
    });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
};
