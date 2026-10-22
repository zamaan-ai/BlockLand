import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLogger';
import { emitVerificationUpdate } from '../lib/socketEvents';
import { isWithinActiveJurisdiction } from '../lib/authorization';
import { getSocketServer } from '../lib/socket';

const documentMetadataSelect = {
  id: true,
  name: true,
  originalName: true,
  mimeType: true,
  size: true,
  sha256Hash: true,
  ipfsHash: true,
  documentType: true,
  isVerified: true,
  createdAt: true,
};

export const getVerificationQueue = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const jurisdiction = req.user!.role === 'ADMIN'
      ? {}
      : {
        state: req.roleAssignment?.jurisdiction === '*'
          ? undefined
          : { equals: req.roleAssignment?.jurisdiction || '__no_assigned_jurisdiction__', mode: 'insensitive' as const },
      };
    const where = {
      status: 'PENDING' as const,
      requestedById: { not: req.user!.id },
      land: { ownerId: { not: req.user!.id }, ...jurisdiction },
    };
    const [requests, count] = await Promise.all([
      prisma.verificationRequest.findMany({
        where,
        include: {
          land: { include: { documents: { select: documentMetadataSelect } } },
          requestedBy: { select: { id: true, name: true, email: true } }
        },
        skip,
        take: limit,
        orderBy: { submittedAt: 'asc' }
      }),
      prisma.verificationRequest.count({ where })
    ]);
    return success(res, { requests, count, page, limit });
  } catch (err) { next(err); }
};

export const getVerificationDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const request = await prisma.verificationRequest.findUnique({
      where: { id: String(req.params.requestId) },
      include: {
        land: { include: { documents: { select: documentMetadataSelect } } },
        requestedBy: { select: { id: true, name: true, email: true, phone: true } }
      }
    });
    if (!request) return error(res, 'Verification request not found', 404);
    if (!isWithinActiveJurisdiction(req, request.land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (request.requestedById === req.user!.id || request.land.ownerId === req.user!.id) return error(res, 'An officer cannot review their own land registration', 403);
    return success(res, { request });
  } catch (err) { next(err); }
};

export const approveVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = String(req.params.requestId);
    const request = await prisma.verificationRequest.findUnique({ where: { id: requestId } });
    if (!request) return error(res, 'Not found', 404);
    if (request.status !== 'PENDING') return error(res, 'Already processed', 400);
    const land = await prisma.land.findUnique({ where: { id: request.landId } });
    if (!land) return error(res, 'Land record not found', 404);
    if (!isWithinActiveJurisdiction(req, land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (request.requestedById === req.user!.id || land.ownerId === req.user!.id) return error(res, 'An officer cannot approve their own land registration', 403);

    const updated = await prisma.$transaction(async (tx) => {
      const vReq = await tx.verificationRequest.update({
        where: { id: requestId },
        data: {
          status: 'APPROVED',
          reviewedById: req.user!.id,
          reviewedAt: new Date()
        }
      });
      await tx.land.update({
        where: { id: vReq.landId },
        data: {
          status: 'VERIFIED',
          verifiedById: req.user!.id,
          verifiedAt: new Date()
        }
      });
      return vReq;
    });

    await logAction('VERIFICATION_APPROVED', req.user!.id, 'VerificationRequest', requestId);
    emitVerificationUpdate(getSocketServer(), requestId, 'APPROVED');
    return success(res, { request: updated }, 'Approved');
  } catch (err) { next(err); }
};

export const rejectVerification = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestId = String(req.params.requestId);
    const { reason } = req.body;
    if (!reason) return error(res, 'Reason required', 400);

    const request = await prisma.verificationRequest.findUnique({ where: { id: requestId } });
    if (!request) return error(res, 'Not found', 404);
    if (request.status !== 'PENDING') return error(res, 'Already processed', 400);
    const land = await prisma.land.findUnique({ where: { id: request.landId } });
    if (!land) return error(res, 'Land record not found', 404);
    if (!isWithinActiveJurisdiction(req, land.state)) return error(res, 'Outside your assigned jurisdiction', 403);
    if (request.requestedById === req.user!.id || land.ownerId === req.user!.id) return error(res, 'An officer cannot reject their own land registration', 403);

    const updated = await prisma.$transaction(async (tx) => {
      const vReq = await tx.verificationRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          rejectionReason: reason,
          reviewedById: req.user!.id,
          reviewedAt: new Date()
        }
      });
      await tx.land.update({
        where: { id: vReq.landId },
        data: { status: 'REJECTED' }
      });
      return vReq;
    });

    await logAction('VERIFICATION_REJECTED', req.user!.id, 'VerificationRequest', requestId, { reason });
    emitVerificationUpdate(getSocketServer(), requestId, 'REJECTED');
    return success(res, { request: updated }, 'Rejected');
  } catch (err) { next(err); }
};
