import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { isWithinActiveJurisdiction } from '../lib/authorization';
import { logAction } from '../lib/auditLogger';
import { notifySavedPropertyWatchers } from '../lib/watchlistNotifications';

export const getUserDashboard = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [lands, transfers, notifications, identity] = await Promise.all([
      prisma.land.findMany({ where: { ownerId: req.user!.id }, include: { encumbrances: { where: { active: true } }, disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } } }, orderBy: { updatedAt: 'desc' } }),
      prisma.transfer.findMany({ where: { OR: [{ fromUserId: req.user!.id }, { toUserId: req.user!.id }] }, include: { land: true, escrow: true }, orderBy: { createdAt: 'desc' } }),
      prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.identityVerification.findFirst({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } })
    ]);
    return success(res, { role: 'USER', lands, transfers, notifications, identity });
  } catch (err) { next(err); }
};

export const getGovernmentDashboard = async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [verificationQueue, transfers, disputes, encumbrances, fraudFlags, stats] = await Promise.all([
      prisma.verificationRequest.findMany({ where: { status: 'PENDING' }, include: { land: true, requestedBy: { select: { id: true, name: true, email: true } } }, orderBy: { submittedAt: 'asc' } }),
      prisma.transfer.findMany({ where: { status: { in: ['LOCKED', 'ESCROW_FUNDED', 'UNDER_REVIEW'] } }, include: { land: true, escrow: true, fromUser: { select: { name: true, email: true } }, toUser: { select: { name: true, email: true } } }, orderBy: { createdAt: 'asc' } }),
      prisma.dispute.findMany({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } }, include: { land: true, raisedBy: { select: { name: true, email: true } } } }),
      prisma.encumbrance.findMany({ where: { active: true }, include: { land: true } }),
      prisma.fraudFlag.findMany({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } }, include: { land: true } }),
      prisma.land.groupBy({ by: ['status'], _count: { _all: true } })
    ]);
    return success(res, { role: 'GOVERNMENT', verificationQueue, transfers, disputes, encumbrances, fraudFlags, stats });
  } catch (err) { next(err); }
};

export const verifyBuyer = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transferId = String(req.params.transferId);
    const transfer = await prisma.transfer.findUnique({ where: { id: transferId }, include: { toUser: true } });
    if (!transfer || !transfer.toUser) return error(res, 'Transfer or buyer not found', 404);
    if (transfer.fromUserId === req.user!.id || transfer.toUserId === req.user!.id) return error(res, 'An officer cannot verify a buyer who is party to the transfer', 403);
    const land = await prisma.land.findUnique({ where: { id: transfer.landId }, select: { state: true } });
    if (!land || !isWithinActiveJurisdiction(req, land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    const updated = await prisma.transfer.update({ where: { id: transferId }, data: { buyerVerified: true, status: 'UNDER_REVIEW' } });
    return success(res, { transfer: updated, buyer: { id: transfer.toUser.id, name: transfer.toUser.name, verified: transfer.toUser.isVerified } }, 'Buyer verified');
  } catch (err) { next(err); }
};

export const freezeLandTransfers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const land = await prisma.land.findUnique({ where: { id: String(req.params.landId) } });
    if (!land) return error(res, 'Land not found', 404);
    if (land.ownerId !== req.user!.id) return error(res, 'Only the current owner can freeze this plot', 403);
    if (land.lockTransferId) return error(res, 'A sale is already locked; contact an officer to review it', 409);
    const reason = String(req.body.reason || 'Owner requested a temporary transfer freeze').trim();
    const updated = await prisma.land.update({ where: { id: land.id }, data: { transferFrozen: true, transferFreezeReason: reason, transferFrozenAt: new Date() } });
    await prisma.notification.create({ data: { userId: req.user!.id, type: 'LAND_TRANSFER_FROZEN', title: 'Transfer freeze enabled', message: `Transfers for ${land.plotId} are frozen.` } });
    return success(res, { land: updated }, 'Transfers frozen for this plot');
  } catch (err) { next(err); }
};

export const unfreezeLandTransfers = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const land = await prisma.land.findUnique({ where: { id: String(req.params.landId) } });
    if (!land) return error(res, 'Land not found', 404);
    if (land.ownerId !== req.user!.id) return error(res, 'Only the current owner can unfreeze this plot', 403);
    if (land.lockTransferId) return error(res, 'A sale is already locked; the active transfer must be resolved first', 409);
    const updated = await prisma.land.update({ where: { id: land.id }, data: { transferFrozen: false, transferFreezeReason: null, transferFrozenAt: null } });
    await prisma.notification.create({ data: { userId: req.user!.id, type: 'LAND_TRANSFER_UNFROZEN', title: 'Transfer freeze removed', message: `Transfers for ${land.plotId} may be initiated again.` } });
    return success(res, { land: updated }, 'Transfer freeze removed');
  } catch (err) { next(err); }
};

export const createEncumbrance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { landId, type, authority, reference, documentHash, startDate, endDate } = req.body;
    if (!landId || !type || !authority || !documentHash) return error(res, 'landId, type, authority, and documentHash are required', 400);
    if (!['MORTGAGE', 'LIEN', 'ACQUISITION_NOTICE', 'COURT_ORDER', 'OTHER'].includes(type)) return error(res, 'Invalid encumbrance type', 400);
    if (!/^[a-fA-F0-9]{64}$/.test(String(documentHash))) return error(res, 'documentHash must be a 64-character SHA-256 hexadecimal digest', 400);
    if (startDate && !Number.isFinite(new Date(startDate).getTime())) return error(res, 'Invalid encumbrance start date', 400);
    if (endDate && !Number.isFinite(new Date(endDate).getTime())) return error(res, 'Invalid encumbrance end date', 400);
    const land = await prisma.land.findUnique({ where: { id: String(landId) } });
    if (!land) return error(res, 'Land not found', 404);
    if (!isWithinActiveJurisdiction(req, land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (req.user!.role === 'GOVERNMENT' && land.ownerId === req.user!.id) return error(res, 'An officer cannot create an encumbrance on their own land', 403);
    const item = await prisma.encumbrance.create({ data: { landId, type, authority, reference, documentHash, startDate: new Date(startDate || Date.now()), endDate: endDate ? new Date(endDate) : undefined, createdById: req.user!.id } });
    await prisma.land.update({ where: { id: landId }, data: { status: 'MORTGAGED' } });
    await notifySavedPropertyWatchers(prisma, String(landId), 'WATCHLIST_ENCUMBRANCE_ADDED', 'Encumbrance added to a watchlisted property', `A new encumbrance was recorded for ${land.plotId}.`, [req.user!.id]);
    await logAction('ENCUMBRANCE_CREATED', req.user!.id, 'Encumbrance', item.id, { landId, documentHash });
    return success(res, { encumbrance: item }, 'Encumbrance recorded', 201);
  } catch (err) { next(err); }
};

export const createDispute = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { landId, caseReference, description } = req.body;
    if (!landId || !caseReference || !description || String(description).length > 5000) return error(res, 'landId, caseReference, and description of at most 5,000 characters are required', 400);
    const land = await prisma.land.findUnique({ where: { id: String(landId) } });
    if (!land) return error(res, 'Land not found', 404);
    if (!isWithinActiveJurisdiction(req, land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (req.user!.role === 'GOVERNMENT' && land.ownerId === req.user!.id) return error(res, 'An officer cannot create a dispute involving their own land', 403);
    const item = await prisma.dispute.create({ data: { landId, caseReference, description, raisedById: req.user!.id } });
    await prisma.land.update({ where: { id: landId }, data: { status: 'DISPUTED' } });
    await notifySavedPropertyWatchers(prisma, String(landId), 'WATCHLIST_DISPUTE_ADDED', 'Dispute opened on a watchlisted property', `A new dispute was recorded for ${land.plotId}.`, [req.user!.id]);
    await logAction('DISPUTE_CREATED', req.user!.id, 'Dispute', item.id, { landId, caseReference });
    return success(res, { dispute: item }, 'Dispute opened', 201);
  } catch (err) { next(err); }
};

export const createFraudFlag = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.body.reason || String(req.body.reason).length > 5000) return error(res, 'Fraud flag reason of at most 5,000 characters is required', 400);
    if (req.body.severity !== undefined && !['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(req.body.severity)) return error(res, 'Invalid fraud severity', 400);
    if (req.body.landId) {
      const land = await prisma.land.findUnique({ where: { id: String(req.body.landId) } });
      if (!land) return error(res, 'Land not found', 404);
      if (req.user!.role === 'GOVERNMENT' && !isWithinActiveJurisdiction(req, land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
      if (req.user!.role === 'GOVERNMENT' && land.ownerId === req.user!.id) return error(res, 'An officer cannot flag their own land', 403);
    }
    const item = await prisma.fraudFlag.create({ data: { landId: req.body.landId, reason: req.body.reason, severity: req.body.severity || 'MEDIUM', reportedById: req.user!.id } });
    if (req.body.landId) await prisma.land.update({ where: { id: req.body.landId }, data: { status: 'UNDER_REVIEW' } });
    if (req.body.landId) {
      const land = await prisma.land.findUnique({ where: { id: String(req.body.landId) }, select: { plotId: true } });
      if (land) await notifySavedPropertyWatchers(prisma, String(req.body.landId), 'WATCHLIST_FRAUD_FLAG', 'Risk review added to a watchlisted property', `A fraud review was opened for ${land.plotId}.`, [req.user!.id]);
    }
    await logAction('FRAUD_FLAG_CREATED', req.user!.id, 'FraudFlag', item.id, { landId: req.body.landId, severity: item.severity });
    return success(res, { fraudFlag: item }, 'Fraud flag created', 201);
  } catch (err) { next(err); }
};

export const getNotifications = async (req: Request, res: Response, next: NextFunction) => {
  try { return success(res, { notifications: await prisma.notification.findMany({ where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' } }) }); } catch (err) { next(err); }
};
