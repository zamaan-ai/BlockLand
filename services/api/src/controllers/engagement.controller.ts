import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLogger';

export const createSiteVisit = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { plotId, name, email, phone, preferredAt, notes } = req.body;
    if (!plotId || !name || !email) return error(res, 'plotId, name and email are required', 400);

    const land = await prisma.land.findUnique({ where: { plotId: String(plotId) } });
    if (!land) return error(res, 'Land not found', 404);

    const visit = await prisma.siteVisit.create({
      data: {
        landId: land.id,
        requesterId: req.user?.id,
        name: String(name),
        email: String(email),
        phone: phone ? String(phone) : undefined,
        preferredAt: preferredAt ? new Date(preferredAt) : undefined,
        notes: notes ? String(notes) : undefined,
      },
    });

    await logAction('SITE_VISIT_REQUESTED', req.user?.id ?? null, 'SiteVisit', visit.id, { plotId });
    return success(res, { visit }, 'Site visit requested', 201);
  } catch (err) {
    next(err);
  }
};

export const listSiteVisits = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plotId = req.query.plotId ? String(req.query.plotId) : undefined;
    const where: any = {};
    if (plotId) {
      const land = await prisma.land.findUnique({ where: { plotId } });
      if (!land) return error(res, 'Land not found', 404);
      where.landId = land.id;
    }
    if (req.user?.role === 'USER') {
      where.OR = [{ requesterId: req.user.id }, { land: { ownerId: req.user.id } }];
    }
    const visits = await prisma.siteVisit.findMany({
      where,
      include: { land: { select: { plotId: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return success(res, { visits });
  } catch (err) {
    next(err);
  }
};

export const createReview = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { plotId, authorName, rating, comment } = req.body;
    if (!plotId || !authorName || rating == null || !comment) {
      return error(res, 'plotId, authorName, rating and comment are required', 400);
    }
    const r = Number(rating);
    if (r < 1 || r > 5) return error(res, 'rating must be 1–5', 400);

    const land = await prisma.land.findUnique({ where: { plotId: String(plotId) } });
    if (!land) return error(res, 'Land not found', 404);

    const review = await prisma.review.create({
      data: {
        landId: land.id,
        authorId: req.user?.id,
        authorName: String(authorName),
        rating: r,
        comment: String(comment),
        isVerifiedVisitor: !!req.user,
      },
    });

    await logAction('REVIEW_CREATED', req.user?.id ?? null, 'Review', review.id, { plotId, rating: r });
    return success(res, { review }, 'Review submitted', 201);
  } catch (err) {
    next(err);
  }
};

export const listReviews = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const plotId = req.query.plotId ? String(req.query.plotId) : undefined;
    if (!plotId) return error(res, 'plotId query required', 400);
    const land = await prisma.land.findUnique({ where: { plotId } });
    if (!land) return error(res, 'Land not found', 404);

    const reviews = await prisma.review.findMany({
      where: { landId: land.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const avg =
      reviews.length > 0 ? reviews.reduce((s, x) => s + x.rating, 0) / reviews.length : null;
    return success(res, { reviews, average: avg, count: reviews.length });
  } catch (err) {
    next(err);
  }
};

export const createEnquiry = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { plotId, name, email, phone, message, toUserId } = req.body;
    if (!name || !email || !message) return error(res, 'name, email and message are required', 400);

    let landId: string | undefined;
    let ownerId: string | undefined;
    if (plotId) {
      const land = await prisma.land.findUnique({ where: { plotId: String(plotId) } });
      if (!land) return error(res, 'Land not found', 404);
      landId = land.id;
      ownerId = land.ownerId || undefined;
    }

    const enquiry = await prisma.enquiry.create({
      data: {
        landId,
        fromUserId: req.user?.id,
        toUserId: toUserId || ownerId,
        name: String(name),
        email: String(email),
        phone: phone ? String(phone) : undefined,
        message: String(message),
      },
    });

    await logAction('ENQUIRY_CREATED', req.user?.id ?? null, 'Enquiry', enquiry.id, { plotId });
    return success(res, { enquiry }, 'Enquiry sent', 201);
  } catch (err) {
    next(err);
  }
};
