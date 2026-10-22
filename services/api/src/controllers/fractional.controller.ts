import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';

export const getFractionalOwners = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plotId = String(req.params.plotId);
    const land = await prisma.land.findUnique({ where: { plotId }, include: { fractionalOwnerships: { include: { user: { select: { id: true, name: true, walletAddress: true } } } } } });
    if (!land) return error(res, 'Land not found', 404);
    return success(res, { fractionalOwnerships: land.fractionalOwnerships });
  } catch (err) { next(err); }
};

export const addFractionalShare = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { landId, coOwnerWallet, sharePercentage } = req.body;
    if (!landId || !coOwnerWallet || !sharePercentage) return error(res, 'Missing fields', 400);

    const land = await prisma.land.findUnique({ where: { id: landId }, include: { fractionalOwnerships: true } });
    if (!land) return error(res, 'Land not found', 404);
    if (land.ownerId !== req.user!.id) return error(res, 'Forbidden', 403);

    const totalCurrentShares = land.fractionalOwnerships.reduce((sum, f) => sum + f.sharePercentage, 0);
    if (totalCurrentShares + sharePercentage > 100) return error(res, 'Total shares cannot exceed 100%', 400);

    const coOwnerUser = await prisma.user.findUnique({ where: { walletAddress: coOwnerWallet } });
    if (!coOwnerUser) return error(res, 'Co-owner user not found', 404);

    const newShare = await prisma.fractionalOwnership.create({
      data: {
        landId,
        userId: coOwnerUser.id,
        walletAddress: coOwnerWallet,
        sharePercentage
      }
    });
    return success(res, { share: newShare }, 'Share added', 201);
  } catch (err) { next(err); }
};

export const updateFractionalShare = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { sharePercentage } = req.body;
    const share = await prisma.fractionalOwnership.findUnique({ where: { id: String(req.params.id) }, include: { land: { include: { fractionalOwnerships: true } } } });
    if (!share) return error(res, 'Not found', 404);
    if (share.land.ownerId !== req.user!.id && req.user!.role !== 'ADMIN') return error(res, 'Forbidden', 403);

    const otherSharesTotal = share.land.fractionalOwnerships.reduce((sum, f) => sum + (f.id === share.id ? 0 : f.sharePercentage), 0);
    if (otherSharesTotal + sharePercentage > 100) return error(res, 'Total shares cannot exceed 100%', 400);

    const updated = await prisma.fractionalOwnership.update({
      where: { id: share.id },
      data: { sharePercentage }
    });
    return success(res, { share: updated }, 'Updated');
  } catch (err) { next(err); }
};

export const deleteFractionalShare = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const share = await prisma.fractionalOwnership.findUnique({ where: { id: String(req.params.id) }, include: { land: true } });
    if (!share) return error(res, 'Not found', 404);
    if (share.land.ownerId !== req.user!.id && req.user!.role !== 'ADMIN') return error(res, 'Forbidden', 403);

    await prisma.fractionalOwnership.delete({ where: { id: share.id } });
    return success(res, null, 'Deleted');
  } catch (err) { next(err); }
};
