import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { computeFileHash } from '../middleware/upload';
import { enqueue } from '../lib/queue';

export const uploadDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) return error(res, 'No file uploaded', 400);
    if (req.body.landId) {
      const land = await prisma.land.findUnique({ where: { id: String(req.body.landId) }, select: { id: true, ownerId: true } });
      if (!land) return error(res, 'Land record not found', 404);
      if (land.ownerId !== req.user!.id && req.user!.role !== 'ADMIN') return error(res, 'Only the plot owner can upload documents to this land record', 403);
    }
    const hash = await computeFileHash(req.file.path);
    const doc = await prisma.document.create({
      data: {
        name: req.body.name || req.file.originalname,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.path,
        sha256Hash: hash,
        documentType: req.body.documentType || 'OTHER',
        userId: req.user!.id,
        landId: req.body.landId || null
      },
      select: {
        id: true, name: true, originalName: true, mimeType: true, size: true,
        sha256Hash: true, ipfsHash: true, documentType: true, isVerified: true,
        userId: true, landId: true, createdAt: true,
      },
    });
    await enqueue('pin-document', { documentId: doc.id });
    return success(res, { document: doc, queued: 'pin-document' }, 'Uploaded', 201);
  } catch (err) { next(err); }
};

export const listMyDocuments = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const documents = await prisma.document.findMany({
      where: { userId: req.user!.id },
      select: {
        id: true, name: true, originalName: true, mimeType: true, size: true,
        sha256Hash: true, ipfsHash: true, documentType: true, isVerified: true,
        userId: true, landId: true, createdAt: true,
        land: { select: { id: true, plotId: true, title: true } },
      },
      orderBy: { createdAt: 'desc' }
    });
    return success(res, { documents, count: documents.length });
  } catch (err) { next(err); }
};

export const getDocumentMetadata = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.document.findUnique({
      where: { id: String(req.params.docId) },
      select: {
        id: true, name: true, originalName: true, mimeType: true, size: true,
        sha256Hash: true, ipfsHash: true, documentType: true, isVerified: true,
        userId: true, landId: true, createdAt: true,
        land: { select: { id: true, plotId: true, title: true, state: true, ownerId: true } },
      }
    });
    if (!doc) return error(res, 'Not found', 404);
    const officerCanReview = req.user!.role === 'GOVERNMENT'
      && doc.land
      && req.roleAssignment?.jurisdiction
      && (req.roleAssignment.jurisdiction === '*' || req.roleAssignment.jurisdiction.toLowerCase() === doc.land.state.toLowerCase())
      && doc.land.ownerId !== req.user!.id
      && await prisma.verificationRequest.findFirst({
        where: { landId: doc.land.id, status: 'PENDING', requestedById: { not: req.user!.id } },
        select: { id: true },
      });
    if (doc.userId !== req.user!.id && doc.land?.ownerId !== req.user!.id && req.user!.role !== 'ADMIN' && !officerCanReview) {
      return error(res, 'Forbidden', 403);
    }
    const { state: _state, ownerId: _ownerId, ...publicLand } = doc.land || {};
    return success(res, { document: { ...doc, land: doc.land ? publicLand : null } });
  } catch (err) { next(err); }
};

export const deleteDocument = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: String(req.params.docId) } });
    if (!doc) return error(res, 'Not found', 404);
    if (doc.userId !== req.user!.id && req.user!.role !== 'ADMIN') return error(res, 'Forbidden', 403);

    if (fs.existsSync(doc.path)) {
      fs.unlinkSync(doc.path);
    }
    await prisma.document.delete({ where: { id: doc.id } });
    return success(res, null, 'Deleted successfully');
  } catch (err) { next(err); }
};
