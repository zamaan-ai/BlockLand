import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';

export const listBuilders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const where: any = { role: 'USER', isVerified: true };
    if (search) {
      where.name = { contains: search as string, mode: 'insensitive' };
    }

    const [builders, count] = await Promise.all([
      prisma.user.findMany({
        where,
        select: { id: true, name: true, avatar: true, createdAt: true, _count: { select: { projects: true } } },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    return success(res, { builders, count, page, limit });
  } catch (err) { next(err); }
};

export const getBuilderByUsername = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const username = String(req.params.username);
    const builder = await prisma.user.findFirst({
      where: { name: { equals: username, mode: 'insensitive' }, role: 'USER', isVerified: true },
      select: {
        id: true, name: true, avatar: true, createdAt: true,
        projects: { include: { _count: { select: { lands: true } } } }
      }
    });
    if (!builder) return error(res, 'Builder not found', 404);
    return success(res, { builder });
  } catch (err) { next(err); }
};
