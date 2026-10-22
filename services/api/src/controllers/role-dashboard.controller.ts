import { Request, Response, NextFunction } from 'express';
import { Prisma, Role } from '@prisma/client';
import prisma from '../lib/prisma';
import { error, success } from '../lib/response';
import { logAction } from '../lib/auditLogger';
import { isWithinActiveJurisdiction } from '../lib/authorization';
import { notifySavedPropertyWatchers } from '../lib/watchlistNotifications';

const publicDocument = {
  id: true,
  name: true,
  originalName: true,
  mimeType: true,
  size: true,
  sha256Hash: true,
  ipfsHash: true,
  documentType: true,
  isVerified: true,
  landId: true,
  userId: true,
  createdAt: true,
};

function jurisdictionWhere(req: Request): Prisma.LandWhereInput {
  if (req.user?.role === 'ADMIN') return {};
  const jurisdiction = req.roleAssignment?.jurisdiction;
  return jurisdiction && jurisdiction !== '*'
    ? { state: { equals: jurisdiction, mode: 'insensitive' } }
    : jurisdiction === '*'
      ? {}
      : { id: '__no_assigned_jurisdiction__' };
}

export const getOwnerDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const [lands, transfers, documents, notifications, identity, shares, events, stats] = await Promise.all([
      prisma.land.findMany({
        where: { ownerId: userId },
        include: {
          encumbrances: { where: { active: true } },
          disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
          fraudFlags: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
          verificationRequests: {
            where: { requestedById: userId },
            select: { id: true, status: true, submittedAt: true, rejectionReason: true },
            orderBy: { submittedAt: 'desc' },
          },
          fractionalOwnerships: { select: { id: true, sharePercentage: true, walletAddress: true, acquiredAt: true } },
          documents: { select: publicDocument },
        },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.transfer.findMany({
        where: { fromUserId: userId },
        include: { land: { select: { id: true, plotId: true, title: true } }, escrow: true, approvals: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.document.findMany({
        where: { OR: [{ userId }, { land: { ownerId: userId } }] },
        select: publicDocument,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.identityVerification.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      prisma.fractionalOwnership.findMany({
        where: { OR: [{ userId }, { land: { ownerId: userId } }] },
        include: { land: { select: { plotId: true, title: true } }, user: { select: { id: true, name: true } } },
      }),
      prisma.ownershipHistory.findMany({
        where: { land: { ownerId: userId } },
        include: { land: { select: { plotId: true } } },
        orderBy: { eventAt: 'desc' },
        take: 100,
      }),
      prisma.land.aggregate({ where: { ownerId: userId }, _sum: { area: true }, _count: { _all: true } }),
    ]);
    return success(res, {
      role: 'LANDOWNER',
      walletAddress: req.user!.walletAddress,
      lands,
      transfers,
      documents,
      notifications,
      identity,
      shares,
      events,
      stats: { totalPlots: stats._count._all, totalArea: stats._sum.area || 0 },
    });
  } catch (err) { next(err); }
};

export const getBuyerDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const [purchases, savedProperties, identity, notifications] = await Promise.all([
      prisma.transfer.findMany({
        where: { toUserId: userId },
        include: {
          land: { include: { encumbrances: { where: { active: true } }, disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } } } },
          escrow: true,
          approvals: { orderBy: { createdAt: 'asc' } },
          ownershipHistory: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.savedLand.findMany({
        where: { userId },
        include: { land: { include: { encumbrances: { where: { active: true } }, disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }, transfers: { where: { status: { in: ['INITIATED', 'LOCKED', 'ESCROW_FUNDED', 'UNDER_REVIEW', 'APPROVED'] } }, select: { id: true } } } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.identityVerification.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return success(res, { role: 'BUYER', purchases, savedProperties, identity, notifications });
  } catch (err) { next(err); }
};

export const saveProperty = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const land = await prisma.land.findUnique({ where: { plotId: String(req.params.plotId) }, select: { id: true, plotId: true } });
    if (!land) return error(res, 'Land not found', 404);
    const saved = await prisma.savedLand.upsert({
      where: { userId_landId: { userId: req.user!.id, landId: land.id } },
      create: { userId: req.user!.id, landId: land.id },
      update: {},
    });
    return success(res, { saved }, 'Property added to watchlist', 201);
  } catch (err) { next(err); }
};

export const removeSavedProperty = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const land = await prisma.land.findUnique({ where: { plotId: String(req.params.plotId) }, select: { id: true } });
    if (!land) return error(res, 'Land not found', 404);
    await prisma.savedLand.deleteMany({ where: { userId: req.user!.id, landId: land.id } });
    return success(res, null, 'Property removed from watchlist');
  } catch (err) { next(err); }
};

export const getDeveloperDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const [profile, projects, lands, enquiries, followers, following, pendingRole] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, phone: true, avatar: true, coverImageUrl: true, bio: true, interests: true, developerVerified: true, profileViews: true },
      }),
      prisma.project.findMany({ where: { developerId: userId }, include: { lands: { select: { id: true, plotId: true, title: true, status: true, district: true, state: true, metadata: true, lockTransferId: true, encumbrances: { where: { active: true }, select: { id: true } }, disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } }, select: { id: true } } } }, _count: { select: { lands: true } } }, orderBy: { updatedAt: 'desc' } }),
      prisma.land.findMany({ where: { ownerId: userId }, select: { id: true, plotId: true, title: true, status: true, district: true, state: true, metadata: true, encumbrances: { where: { active: true }, select: { id: true, type: true } }, disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } }, select: { id: true, status: true } } }, orderBy: { updatedAt: 'desc' } }),
      prisma.enquiry.findMany({ where: { toUserId: userId }, include: { land: { select: { plotId: true, title: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
      prisma.userFollow.count({ where: { followingId: userId } }),
      prisma.userFollow.count({ where: { followerId: userId } }),
      prisma.userRoleAssignment.findFirst({ where: { userId, role: 'DEVELOPER', active: false }, select: { id: true, createdAt: true } }),
    ]);
    return success(res, { role: 'DEVELOPER', profile, projects, lands, enquiries, followers, following, pendingRole });
  } catch (err) { next(err); }
};

export const updateDeveloperProfile = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { bio, coverImageUrl, interests } = req.body;
    if (bio !== undefined && (typeof bio !== 'string' || bio.length > 2000)) return error(res, 'Bio must be a string of at most 2,000 characters', 400);
    if (coverImageUrl !== undefined && (typeof coverImageUrl !== 'string' || coverImageUrl.length > 2048)) return error(res, 'Cover image URL is invalid', 400);
    if (interests !== undefined && (!Array.isArray(interests) || interests.length > 30 || interests.some((entry: unknown) => typeof entry !== 'string' || entry.length > 80))) {
      return error(res, 'Interests must be an array of at most 30 strings, each at most 80 characters', 400);
    }
    const profile = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(bio !== undefined ? { bio: bio.trim() || null } : {}),
        ...(coverImageUrl !== undefined ? { coverImageUrl: coverImageUrl.trim() || null } : {}),
        ...(interests !== undefined ? { interests: interests.map((item: string) => item.trim()).filter(Boolean) } : {}),
      },
      select: { id: true, name: true, bio: true, coverImageUrl: true, interests: true, developerVerified: true },
    });
    await logAction('DEVELOPER_PROFILE_UPDATED', req.user!.id, 'User', profile.id);
    return success(res, { profile }, 'Developer profile updated');
  } catch (err) { next(err); }
};

export const requestDeveloperRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const existing = await prisma.userRoleAssignment.findUnique({ where: { userId_role: { userId: req.user!.id, role: 'DEVELOPER' } } });
    if (existing?.active) return success(res, { status: 'ACTIVE' }, 'Developer access is already active');
    const assignment = await prisma.userRoleAssignment.upsert({
      where: { userId_role: { userId: req.user!.id, role: 'DEVELOPER' } },
      create: { userId: req.user!.id, role: 'DEVELOPER', active: false },
      update: { active: false, grantedById: null },
    });
    await logAction('DEVELOPER_ROLE_REQUESTED', req.user!.id, 'UserRoleAssignment', assignment.id);
    return success(res, { status: assignment.active ? 'ACTIVE' : 'PENDING' }, 'Developer role request recorded', 201);
  } catch (err) { next(err); }
};

export const followDeveloper = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const developerId = String(req.params.userId);
    if (developerId === req.user!.id) return error(res, 'You cannot follow your own profile', 400);
    const developer = await prisma.userRoleAssignment.findFirst({ where: { userId: developerId, role: 'DEVELOPER', active: true }, select: { userId: true } });
    if (!developer) return error(res, 'Verified developer profile not found', 404);
    await prisma.userFollow.upsert({
      where: { followerId_followingId: { followerId: req.user!.id, followingId: developerId } },
      create: { followerId: req.user!.id, followingId: developerId },
      update: {},
    });
    return success(res, null, 'Developer followed', 201);
  } catch (err) { next(err); }
};

export const submitPublicObjection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plotId = String(req.params.plotId);
    const { name, email, reason, evidenceHash } = req.body;
    if (!name || !email || !reason) return error(res, 'Name, email, and objection reason are required', 400);
    const land = await prisma.land.findUnique({ where: { plotId } });
    if (!land) return error(res, 'Land record not found', 404);
    if (!['PENDING', 'UNDER_REVIEW'].includes(land.status)) return error(res, 'Public objections are closed for this record', 409);
    const objection = await prisma.publicObjection.create({
      data: { landId: land.id, submittedById: req.user?.id, name: String(name), email: String(email), reason: String(reason), evidenceHash: evidenceHash ? String(evidenceHash) : null },
      select: { id: true, landId: true, name: true, reason: true, status: true, createdAt: true },
    });
    await logAction('PUBLIC_OBJECTION_SUBMITTED', req.user?.id || null, 'PublicObjection', objection.id, { plotId });
    return success(res, { objection }, 'Objection submitted for officer review', 201);
  } catch (err) { next(err); }
};

export const resolvePublicObjection = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const objection = await prisma.publicObjection.findUnique({ where: { id: String(req.params.objectionId) }, include: { land: true } });
    if (!objection) return error(res, 'Objection not found', 404);
    if (!isWithinActiveJurisdiction(req, objection.land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (req.user!.role === 'GOVERNMENT' && (objection.land.ownerId === req.user!.id || objection.submittedById === req.user!.id)) return error(res, 'An officer cannot resolve an objection involving themselves or their land', 403);
    if (objection.status !== 'OPEN') return error(res, 'Objection already resolved', 409);
    const { resolution, status } = req.body;
    if (!resolution || !['RESOLVED', 'DISMISSED'].includes(status)) return error(res, 'Resolution and a RESOLVED or DISMISSED status are required', 400);
    const updated = await prisma.publicObjection.update({
      where: { id: objection.id },
      data: { status, resolution: String(resolution), resolvedById: req.user!.id, resolvedAt: new Date() },
      select: { id: true, status: true, resolution: true, resolvedAt: true },
    });
    await logAction('PUBLIC_OBJECTION_RESOLVED', req.user!.id, 'PublicObjection', objection.id, { status });
    return success(res, { objection: updated }, 'Objection updated');
  } catch (err) { next(err); }
};

export const clearEncumbrance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const item = await prisma.encumbrance.findUnique({ where: { id: String(req.params.encumbranceId) }, include: { land: true } });
    if (!item) return error(res, 'Encumbrance not found', 404);
    if (!isWithinActiveJurisdiction(req, item.land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (req.user!.role === 'GOVERNMENT' && item.land.ownerId === req.user!.id) return error(res, 'An officer cannot act on an encumbrance involving their own land', 403);
    if (!req.body.resolution || !req.body.documentHash) return error(res, 'Resolution and supporting documentHash are required', 400);
    if (!/^[a-fA-F0-9]{64}$/.test(String(req.body.documentHash))) return error(res, 'documentHash must be a 64-character SHA-256 hexadecimal digest', 400);
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.encumbrance.update({ where: { id: item.id }, data: { active: false, endDate: new Date(), reference: `${item.reference || ''} ${String(req.body.resolution)}`.trim() } });
      const stillBlocked = await tx.encumbrance.count({ where: { landId: item.landId, active: true, id: { not: item.id } } })
        + await tx.dispute.count({ where: { landId: item.landId, status: { in: ['OPEN', 'UNDER_REVIEW'] } } })
        + await tx.fraudFlag.count({ where: { landId: item.landId, status: { in: ['OPEN', 'UNDER_REVIEW'] } } })
        + await tx.verificationRequest.count({ where: { landId: item.landId, status: 'PENDING' } });
      if (!stillBlocked && item.land.status === 'MORTGAGED') {
        await tx.land.update({ where: { id: item.landId }, data: { status: 'VERIFIED' } });
      }
      return updated;
    });
    await logAction('ENCUMBRANCE_CLEARED', req.user!.id, 'Encumbrance', item.id, { resolution: req.body.resolution, documentHash: req.body.documentHash });
    await notifySavedPropertyWatchers(prisma, item.landId, 'WATCHLIST_ENCUMBRANCE_CLEARED', 'Encumbrance cleared on a watchlisted property', `An encumbrance on ${item.land.plotId} was cleared.`);
    return success(res, { encumbrance: result }, 'Encumbrance cleared and recorded');
  } catch (err) { next(err); }
};

export const resolveDispute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dispute = await prisma.dispute.findUnique({ where: { id: String(req.params.disputeId) }, include: { land: true } });
    if (!dispute) return error(res, 'Dispute not found', 404);
    if (!isWithinActiveJurisdiction(req, dispute.land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (req.user!.role === 'GOVERNMENT' && (dispute.land.ownerId === req.user!.id || dispute.raisedById === req.user!.id)) return error(res, 'An officer cannot resolve a dispute involving themselves or their land', 403);
    const { resolution, status } = req.body;
    if (!resolution || !['RESOLVED', 'DISMISSED'].includes(status)) return error(res, 'Resolution and a RESOLVED or DISMISSED status are required', 400);
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.dispute.update({ where: { id: dispute.id }, data: { status, resolution: String(resolution), resolvedById: req.user!.id } });
      const openDisputes = await tx.dispute.count({ where: { landId: dispute.landId, status: { in: ['OPEN', 'UNDER_REVIEW'] }, id: { not: dispute.id } } });
      const activeEncumbrances = await tx.encumbrance.count({ where: { landId: dispute.landId, active: true } });
      const openFraudFlags = await tx.fraudFlag.count({ where: { landId: dispute.landId, status: { in: ['OPEN', 'UNDER_REVIEW'] } } });
      const pendingVerification = await tx.verificationRequest.count({ where: { landId: dispute.landId, status: 'PENDING' } });
      if (!openDisputes && !activeEncumbrances && !openFraudFlags && !pendingVerification && dispute.land.status === 'DISPUTED') {
        await tx.land.update({ where: { id: dispute.landId }, data: { status: 'VERIFIED' } });
      }
      return updated;
    });
    await logAction('DISPUTE_RESOLVED', req.user!.id, 'Dispute', dispute.id, { status, resolution });
    await notifySavedPropertyWatchers(prisma, dispute.landId, 'WATCHLIST_DISPUTE_RESOLVED', 'Dispute status changed on a watchlisted property', `A dispute on ${dispute.land.plotId} was ${String(status).toLowerCase()}.`);
    return success(res, { dispute: result }, 'Dispute resolution recorded');
  } catch (err) { next(err); }
};

export const resolveFraudFlag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const flag = await prisma.fraudFlag.findUnique({ where: { id: String(req.params.flagId) }, include: { land: true } });
    if (!flag) return error(res, 'Fraud flag not found', 404);
    if (flag.land && !isWithinActiveJurisdiction(req, flag.land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (req.user!.role === 'GOVERNMENT' && (flag.land?.ownerId === req.user!.id || flag.reportedById === req.user!.id)) return error(res, 'An officer cannot resolve a fraud report involving themselves or their land', 403);
    if (!req.body.resolution || !['RESOLVED', 'DISMISSED'].includes(req.body.status)) return error(res, 'Resolution and a RESOLVED or DISMISSED status are required', 400);
    const updated = await prisma.fraudFlag.update({
      where: { id: flag.id },
      data: { status: req.body.status, resolution: String(req.body.resolution), reviewedById: req.user!.id },
    });
    if (flag.land && flag.land.status === 'UNDER_REVIEW') {
      const [openFraudFlags, openDisputes, activeEncumbrances, pendingVerification] = await Promise.all([
        prisma.fraudFlag.count({ where: { landId: flag.land.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
        prisma.dispute.count({ where: { landId: flag.land.id, status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
        prisma.encumbrance.count({ where: { landId: flag.land.id, active: true } }),
        prisma.verificationRequest.count({ where: { landId: flag.land.id, status: 'PENDING' } }),
      ]);
      if (!openFraudFlags && !openDisputes && !activeEncumbrances && !pendingVerification) {
        await prisma.land.update({ where: { id: flag.land.id }, data: { status: 'VERIFIED' } });
      }
    }
    await logAction('FRAUD_FLAG_RESOLVED', req.user!.id, 'FraudFlag', flag.id, { status: req.body.status, resolution: req.body.resolution });
    if (flag.landId && flag.land) await notifySavedPropertyWatchers(prisma, flag.landId, 'WATCHLIST_FRAUD_REVIEW_RESOLVED', 'Risk review status changed on a watchlisted property', `A fraud review on ${flag.land.plotId} was ${String(req.body.status).toLowerCase()}.`);
    return success(res, { fraudFlag: updated }, 'Fraud review recorded');
  } catch (err) { next(err); }
};

export const getHighRiskTransfers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfers = await prisma.transfer.findMany({
      where: {
        status: { in: ['LOCKED', 'ESCROW_FUNDED', 'UNDER_REVIEW'] },
        land: jurisdictionWhere(req),
        fromUserId: { not: req.user!.id },
        toUserId: { not: req.user!.id },
        OR: [
          { land: { fraudFlags: { some: { status: { in: ['OPEN', 'UNDER_REVIEW'] }, severity: { in: ['HIGH', 'CRITICAL'] } } } } },
          { escrow: { amount: { gte: Number(process.env.SECOND_APPROVAL_THRESHOLD_INR || 5000000) } } },
        ],
      },
      include: { land: { select: { plotId: true, title: true, state: true, metadata: true, fraudFlags: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } }, select: { id: true, severity: true, reason: true } } } }, escrow: true, approvals: true },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return success(res, { transfers });
  } catch (err) { next(err); }
};

export const unfollowDeveloper = async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.userFollow.deleteMany({ where: { followerId: req.user!.id, followingId: String(req.params.userId) } });
    return success(res, null, 'Developer unfollowed');
  } catch (err) { next(err); }
};

export const getOfficerDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = jurisdictionWhere(req);
    const [verificationQueue, transfers, disputes, encumbrances, fraudFlags, objections, auditLogs, stats] = await Promise.all([
      prisma.verificationRequest.findMany({ where: { status: 'PENDING', land: scope }, include: { land: { include: { documents: { select: publicDocument } } }, requestedBy: { select: { id: true, name: true, email: true } } }, orderBy: { submittedAt: 'asc' }, take: 100 }),
      prisma.transfer.findMany({ where: { status: { in: ['LOCKED', 'ESCROW_FUNDED', 'UNDER_REVIEW'] }, land: scope }, include: { land: true, escrow: true, fromUser: { select: { id: true, name: true } }, toUser: { select: { id: true, name: true } }, approvals: true }, orderBy: { createdAt: 'asc' }, take: 100 }),
      prisma.dispute.findMany({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] }, land: scope }, include: { land: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.encumbrance.findMany({ where: { active: true, land: scope }, include: { land: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.fraudFlag.findMany({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] }, land: { is: scope } }, include: { land: true }, orderBy: [{ severity: 'desc' }, { createdAt: 'asc' }], take: 100 }),
      prisma.publicObjection.findMany({ where: { status: 'OPEN', land: scope }, include: { land: { select: { plotId: true, state: true, district: true, title: true, metadata: true } } }, orderBy: { createdAt: 'asc' }, take: 100 }),
      prisma.auditLog.findMany({ where: { actorId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      prisma.land.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    ]);
    return success(res, {
      role: 'GOVERNMENT',
      jurisdiction: req.roleAssignment?.jurisdiction || null,
      verificationQueue: verificationQueue.filter((item) => item.requestedById !== req.user!.id && item.land.ownerId !== req.user!.id),
      transfers: transfers.filter((item) => item.fromUserId !== req.user!.id && item.toUserId !== req.user!.id),
      disputes, encumbrances, fraudFlags, objections, auditLogs, stats,
    });
  } catch (err) { next(err); }
};

export const getRoleOptions = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roles = await prisma.userRoleAssignment.findMany({ where: { userId: req.user!.id, active: true }, select: { role: true, jurisdiction: true } });
    return success(res, { roles, activeRole: req.user!.role });
  } catch (err) { next(err); }
};

export const roleFromString = (role: string): Role | null => {
  const allowed: Role[] = ['USER', 'LANDOWNER', 'BUYER', 'DEVELOPER', 'GOVERNMENT', 'ADMIN'];
  return allowed.includes(role as Role) ? role as Role : null;
};
