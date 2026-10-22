import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { cacheWrap, cacheDel } from '../lib/cache';
import { logAction } from '../lib/auditLogger';
import { emitNewRegistration } from '../lib/socketEvents';
import { getSocketServer } from '../lib/socket';

export const listLands = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = String(req.query.q || '').trim();
    const status = req.query.status ? String(req.query.status) : undefined;
    const state = req.query.state ? String(req.query.state) : undefined;
    const cacheKey = `lands:${q}:${status || ''}:${state || ''}`;

    const payload = await cacheWrap(cacheKey, 30, async () => {
      const lands = await prisma.land.findMany({
        where: {
          ...(status ? { status: status as never } : {}),
          ...(state ? { state } : {}),
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  { plotId: { contains: q, mode: 'insensitive' } },
                  { village: { contains: q, mode: 'insensitive' } },
                  { district: { contains: q, mode: 'insensitive' } },
                  { surveyNumber: { contains: q, mode: 'insensitive' } },
                  { description: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: 'desc' },
      });
      return { lands, count: lands.length };
    });

    return success(res, payload);
  } catch (err) {
    next(err);
  }
};

export const searchLands = async (req: Request, res: Response, next: NextFunction) => {
  try {
    req.query.q = req.query.q || req.query.query;
    return listLands(req, res, next);
  } catch (err) {
    next(err);
  }
};

export const getLand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const land = await prisma.land.findUnique({
      where: { plotId: String(req.params.plotId) },
      include: { owner: { select: { id: true, name: true, walletAddress: true, isVerified: true } } },
    });
    if (!land) return error(res, 'Land not found', 404);
    return success(res, { land });
  } catch (err) {
    next(err);
  }
};

export const registerLand = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, state, district, village, surveyNumber, area, latitude, longitude } = req.body;
    if (!title || !state || !district || !village || !surveyNumber || !Number.isFinite(Number(area)) || Number(area) <= 0) {
      return error(res, 'Title, state, district, village, survey number, and positive area are required', 400);
    }
    if ((latitude !== undefined && (!Number.isFinite(Number(latitude)) || Number(latitude) < -90 || Number(latitude) > 90))
      || (longitude !== undefined && (!Number.isFinite(Number(longitude)) || Number(longitude) < -180 || Number(longitude) > 180))) {
      return error(res, 'Coordinates are outside valid latitude/longitude ranges', 400);
    }
    const plotId = `PLOT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const data = {
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      state: String(state).trim(),
      district: String(district).trim(),
      village: String(village).trim(),
      surveyNumber: String(surveyNumber).trim(),
      area: Number(area),
      latitude: latitude == null ? null : Number(latitude),
      longitude: longitude == null ? null : Number(longitude),
      plotId,
      ownerId: req.user!.id,
      ownerWallet: req.user!.walletAddress || null,
    };
    const land = await prisma.$transaction(async (tx) => {
      const createdLand = await tx.land.create({ data });
      await tx.verificationRequest.create({
        data: { landId: createdLand.id, requestedById: req.user!.id },
      });
      return createdLand;
    });
    await cacheDel('lands:::');
    await logAction('LAND_REGISTERED', req.user!.id, 'Land', land.id, { plotId });
    emitNewRegistration(getSocketServer(), plotId);
    return success(res, { land }, 'Land registered', 201);
  } catch (err) {
    next(err);
  }
};
