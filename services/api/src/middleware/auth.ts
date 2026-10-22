import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../lib/jwt';
import prisma from '../lib/prisma';
import { error } from '../lib/response';
import { Role } from '@prisma/client';

async function ensureLegacyRoleAssignments(userId: string, legacyRole: Role) {
  const existing = await prisma.userRoleAssignment.findMany({ where: { userId } });
  if (existing.length) return existing.filter((assignment) => assignment.active);

  const roles: Role[] = legacyRole === 'USER'
    ? ['USER', 'LANDOWNER', 'BUYER']
    : [legacyRole];
  await prisma.userRoleAssignment.createMany({
    data: roles.map((role) => ({ userId, role, active: true })),
    skipDuplicates: true,
  });
  return prisma.userRoleAssignment.findMany({ where: { userId, active: true } });
}

export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      error(res, 'Unauthorized', 401);
      return;
    }

    const token = authHeader.split(' ')[1];
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive) {
      error(res, 'User not found or inactive', 401);
      return;
    }

    const roles = await ensureLegacyRoleAssignments(user.id, user.role);
    const activeAssignment = roles.find((assignment) => assignment.role === payload.role);
    if (!activeAssignment) {
      error(res, 'This session role is no longer active. Sign in again or switch roles.', 403);
      return;
    }
    req.user = { ...user, role: activeAssignment.role, roleAssignments: roles };
    req.roleAssignment = activeAssignment;
    next();
  } catch (err) {
    error(res, 'Invalid token', 401);
  }
};

export const optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const payload = verifyAccessToken(token);
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (user && user.isActive) {
        const roles = await ensureLegacyRoleAssignments(user.id, user.role);
        const assignment = roles.find((entry) => entry.role === payload.role);
        if (assignment) {
          req.user = { ...user, role: assignment.role, roleAssignments: roles };
          req.roleAssignment = assignment;
        }
      }
    }
    next();
  } catch (err) {
    next();
  }
};

export const requireRole = (...roles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      error(res, 'Unauthorized', 401);
      return;
    }
    if (!roles.includes(req.user.role)) {
      error(res, 'Forbidden: insufficient permissions', 403);
      return;
    }
    next();
  };
};
