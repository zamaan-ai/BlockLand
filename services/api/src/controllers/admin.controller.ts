import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLogger';
import { roleFromString } from './role-dashboard.controller';
import bcrypt from 'bcryptjs';

export const getStats = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [totalLands, totalUsers, verifiedUsers, pendingLands, activeTransfers, openFraudFlags] = await Promise.all([
      prisma.land.count(),
      prisma.user.count(),
      prisma.user.count({ where: { isVerified: true } }),
      prisma.land.count({ where: { status: 'PENDING' } }),
      prisma.transfer.count({ where: { status: { in: ['INITIATED', 'LOCKED', 'ESCROW_FUNDED', 'UNDER_REVIEW'] } } }),
      prisma.fraudFlag.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
    ]);
    return success(res, { stats: { totalLands, totalUsers, verifiedUsers, pendingLands, activeTransfers, openFraudFlags } });
  } catch(err) { next(err); }
};

export const getAuditLogs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q || '').trim();
    const action = req.query.action ? String(req.query.action) : undefined;
    const logs = await prisma.auditLog.findMany({
      where: {
        ...(action ? { action: { contains: action, mode: 'insensitive' as const } } : {}),
        ...(q ? { OR: [
          { action: { contains: q, mode: 'insensitive' } },
          { targetType: { contains: q, mode: 'insensitive' } },
          { targetId: { contains: q, mode: 'insensitive' } },
          { actorId: { contains: q, mode: 'insensitive' } },
        ] } : {}),
      },
      include: { actor: { select: { id: true, name: true, email: true } } },
      take: 100,
      orderBy: { createdAt: 'desc' },
    });
    return success(res, { logs, count: logs.length });
  } catch(err) { next(err); }
};

export const getUsers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q || '').trim();
    const users = await prisma.user.findMany({
      take: 50,
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } : {},
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, name: true, email: true, role: true, isActive: true, isVerified: true, createdAt: true,
        roleAssignments: { select: { id: true, role: true, jurisdiction: true, active: true, createdAt: true } },
      },
    });
    return success(res, { users, count: users.length });
  } catch(err) { next(err); }
};

export const grantRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId);
    const role = roleFromString(String(req.body.role || ''));
    const jurisdiction = req.body.jurisdiction == null ? null : String(req.body.jurisdiction).trim();
    if (!role) return error(res, 'Unsupported role', 400);
    if (role === 'GOVERNMENT' && !jurisdiction) return error(res, 'Government roles require an assigned jurisdiction; use * only for an expressly authorized global officer', 400);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return error(res, 'User not found', 404);
    const assignment = await prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId, role } },
      create: { userId, role, jurisdiction, grantedById: req.user!.id, active: true },
      update: { jurisdiction, grantedById: req.user!.id, active: true },
    });
    await logAction('ROLE_GRANTED', req.user!.id, 'UserRoleAssignment', assignment.id, { userId, role, jurisdiction });
    return success(res, { assignment }, 'Role granted');
  } catch (err) { next(err); }
};

export const createOfficer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const jurisdiction = String(req.body.jurisdiction || '').trim();
    if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(res, 'A valid name and email address are required', 400);
    if (password.length < 12 || password.length > 128) return error(res, 'Officer password must contain 12 to 128 characters', 400);
    if (!jurisdiction) return error(res, 'An assigned jurisdiction is required; use * only for an expressly authorized global officer', 400);
    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) return error(res, 'An account already exists for this email', 409);
    const passwordHash = await bcrypt.hash(password, 12);
    const officer = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name, email, passwordHash, role: 'GOVERNMENT', emailVerified: false },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });
      const assignment = await tx.userRoleAssignment.create({
        data: { userId: created.id, role: 'GOVERNMENT', jurisdiction, grantedById: req.user!.id, active: true },
        select: { id: true, role: true, jurisdiction: true, active: true },
      });
      return { ...created, assignment };
    });
    await logAction('OFFICER_ACCOUNT_CREATED', req.user!.id, 'User', officer.id, { jurisdiction });
    return success(res, { officer }, 'Officer account created', 201);
  } catch (err) { next(err); }
};

export const revokeRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assignmentId = String(req.params.assignmentId);
    const assignment = await prisma.userRoleAssignment.findUnique({ where: { id: assignmentId } });
    if (!assignment) return error(res, 'Role assignment not found', 404);
    if (assignment.userId === req.user!.id && assignment.role === 'ADMIN') {
      const activeAdmins = await prisma.userRoleAssignment.count({ where: { role: 'ADMIN', active: true } });
      if (activeAdmins <= 1) return error(res, 'Cannot revoke the final active administrator role', 409);
    }
    const revoked = await prisma.userRoleAssignment.update({ where: { id: assignment.id }, data: { active: false, grantedById: req.user!.id } });
    await logAction('ROLE_REVOKED', req.user!.id, 'UserRoleAssignment', assignment.id, { userId: assignment.userId, role: assignment.role });
    return success(res, { assignment: revoked }, 'Role revoked');
  } catch (err) { next(err); }
};

export const setUserActive = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = String(req.params.userId);
    const isActive = req.body.isActive;
    if (typeof isActive !== 'boolean') return error(res, 'isActive must be a boolean', 400);
    if (userId === req.user!.id && !isActive) return error(res, 'You cannot suspend your own active account', 400);
    const user = await prisma.user.update({ where: { id: userId }, data: { isActive }, select: { id: true, email: true, name: true, isActive: true } });
    if (!isActive) await prisma.refreshToken.deleteMany({ where: { userId } });
    await logAction(isActive ? 'USER_ACTIVATED' : 'USER_SUSPENDED', req.user!.id, 'User', userId);
    return success(res, { user }, isActive ? 'User activated' : 'User suspended');
  } catch (err) { next(err); }
};

export const getPendingRoleRequests = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const requests = await prisma.userRoleAssignment.findMany({
      where: { active: false, grantedById: null, role: { in: ['DEVELOPER', 'GOVERNMENT'] } },
      include: { user: { select: { id: true, name: true, email: true, isVerified: true } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return success(res, { requests, count: requests.length });
  } catch (err) { next(err); }
};

export const recordLegalCorrection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { landId, caseReference, description, correctedOwnerId, correctedOwnerWallet, documentHash } = req.body;
    if (!landId || !caseReference || !description || !documentHash) {
      return error(res, 'landId, caseReference, description, and documentHash are required', 400);
    }
    if (!/^[a-fA-F0-9]{64}$/.test(String(documentHash))) return error(res, 'documentHash must be a 64-character SHA-256 hexadecimal digest', 400);
    const land = await prisma.land.findUnique({ where: { id: String(landId) } });
    if (!land) return error(res, 'Land not found', 404);
    if (correctedOwnerId && !await prisma.user.findUnique({ where: { id: String(correctedOwnerId) }, select: { id: true } })) {
      return error(res, 'Corrected owner account not found', 404);
    }

    const result = await prisma.$transaction(async (tx) => {
      const event = await tx.ownershipHistory.create({
        data: {
          landId: land.id,
          ownerId: String(correctedOwnerId || land.ownerId || req.user!.id),
          ownerWallet: correctedOwnerWallet || land.ownerWallet,
          eventType: 'COURT_ORDERED_CORRECTION',
          metadata: { caseReference: String(caseReference), description: String(description), documentHash: String(documentHash), recordedBy: req.user!.id },
        },
      });
      const updatedLand = correctedOwnerId
        ? await tx.land.update({ where: { id: land.id }, data: { ownerId: String(correctedOwnerId), ownerWallet: correctedOwnerWallet || null } })
        : land;
      return { event, land: updatedLand };
    });
    await logAction('LEGAL_CORRECTION_RECORDED', req.user!.id, 'Land', land.id, { caseReference, eventId: result.event.id, documentHash });
    return success(res, result, 'Correction recorded as an immutable ownership-history event', 201);
  } catch (err) { next(err); }
};

export const getSystemHealth = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [dbResult, failedTransfers, queuedDocuments, pendingNotifications, roleAssignments] = await Promise.all([
      prisma.$queryRaw`SELECT 1 AS healthy`,
      prisma.transfer.count({ where: { status: { in: ['REJECTED', 'REFUNDED'] } } }),
      prisma.document.count({ where: { ipfsHash: null } }),
      prisma.notification.count({ where: { readAt: null } }),
      prisma.userRoleAssignment.count({ where: { active: false } }),
    ]);
    return success(res, {
      health: { database: Array.isArray(dbResult) ? 'OK' : 'UNKNOWN', api: 'OK', checkedAt: new Date().toISOString() },
      monitoring: { failedOrRefundedTransfers: failedTransfers, documentsAwaitingPinning: queuedDocuments, unreadNotifications: pendingNotifications, pendingAccessRequests: roleAssignments },
    });
  } catch (err) { next(err); }
};
