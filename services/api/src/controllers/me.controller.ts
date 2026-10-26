import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';

export const getStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const [plots, transfers, documents, verifiedPlots] = await Promise.all([
      prisma.land.count({ where: { ownerId: userId } }),
      prisma.transfer.count({ where: { OR: [{ fromUserId: userId }, { toUserId: userId }] } }),
      prisma.document.count({ where: { userId } }),
      prisma.land.count({ where: { ownerId: userId, status: 'VERIFIED' } })
    ]);
    return success(res, { stats: { plots, transfers, documents, verifiedPlots } });
  } catch (err) { next(err); }
};

export const getProperties = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as any;
    const where: any = { ownerId: req.user!.id };
    if (status) where.status = status;

    const lands = await prisma.land.findMany({ where, orderBy: { createdAt: 'desc' } });
    return success(res, { lands, count: lands.length });
  } catch (err) { next(err); }
};

export const getTransfers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfers = await prisma.transfer.findMany({
      where: { OR: [{ fromUserId: req.user!.id }, { toUserId: req.user!.id }] },
      include: {
        land: { select: { plotId: true, title: true } },
        fromUser: { select: { id: true, name: true, walletAddress: true } },
        toUser: { select: { id: true, name: true, walletAddress: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return success(res, { transfers, count: transfers.length });
  } catch (err) { next(err); }
};

export const getDocuments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const documents = await prisma.document.findMany({
      where: { userId: req.user!.id },
      include: { land: { select: { plotId: true, title: true } } },
      orderBy: { createdAt: 'desc' }
    });
    return success(res, { documents, count: documents.length });
  } catch (err) { next(err); }
};

export const updateProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, phone, avatar } = req.body;
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: { name, phone, avatar }
    });
    const { passwordHash, ...user } = updated;
    return success(res, { user }, 'Profile updated');
  } catch (err) { next(err); }
};

export const changePassword = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { oldPassword, newPassword, confirmPassword } = req.body;
    if (newPassword !== confirmPassword) return error(res, 'Passwords do not match', 400);

    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user || !(await bcrypt.compare(oldPassword, user.passwordHash))) {
      return error(res, 'Invalid old password', 400);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await prisma.user.update({
      where: { id: req.user!.id },
      data: { passwordHash }
    });

    return success(res, null, 'Password changed');
  } catch (err) { next(err); }
};
