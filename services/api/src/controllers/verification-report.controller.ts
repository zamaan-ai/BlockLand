import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';

export const getVerificationReport = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const land = await prisma.land.findUnique({ where: { plotId: String(req.params.plotId) }, include: { owner: { select: { id: true, name: true, walletAddress: true, isVerified: true, aadhaarVerified: true, emailVerified: true } }, documents: { select: { id: true, documentType: true, sha256Hash: true, isVerified: true, createdAt: true } }, encumbrances: { where: { active: true } }, disputes: { where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }, transfers: { where: { status: { in: ['INITIATED', 'LOCKED', 'ESCROW_FUNDED', 'UNDER_REVIEW', 'APPROVED'] } }, select: { id: true, status: true, cooldownEndsAt: true, createdAt: true } }, ownershipHistory: { orderBy: { eventAt: 'asc' } } } });
    if (!land) return error(res, 'Land not found', 404);
    const identity = land.ownerId ? await prisma.identityVerification.findFirst({ where: { userId: land.ownerId, status: 'VERIFIED', provider: { not: 'OTP_ONLY' } }, orderBy: { verifiedAt: 'desc' } }) : null;
    const blocked = land.encumbrances.length > 0 || land.disputes.length > 0 || land.transfers.length > 0 || ['UNDER_REVIEW', 'DISPUTED', 'MORTGAGED'].includes(land.status);
    const safe = land.status === 'VERIFIED' && !!land.owner?.isVerified && !!land.verifiedAt && land.disputes.length === 0 && land.encumbrances.length === 0 && land.transfers.length === 0;
    return success(res, { report: { plotId: land.plotId, land, ownerIdentity: { verified: !!land.owner?.isVerified && !!identity, aadhaarVerified: !!land.owner?.aadhaarVerified, walletLinked: !!land.owner?.walletAddress }, governmentVerified: land.status === 'VERIFIED' || land.status === 'TRANSFERRED', blockchainRecorded: !!land.blockchainTxHash || !!land.tokenId, activeTransfer: land.transfers[0] || null, encumbrances: land.encumbrances, disputes: land.disputes, ownershipHistory: land.ownershipHistory, risk: safe ? 'SAFE_TO_REVIEW' : blocked ? 'DO_NOT_PROCEED' : 'CAUTION' } });
  } catch (err) { next(err); }
};
