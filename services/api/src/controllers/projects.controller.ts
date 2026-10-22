import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { success, error } from '../lib/response';

export const listProjects = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { featured, status, developerId } = req.query;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (featured === 'true') where.isFeatured = true;
    if (status) where.status = status;
    if (developerId) where.developerId = developerId;

    const [projects, count] = await Promise.all([
      prisma.project.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
      prisma.project.count({ where })
    ]);

    return success(res, { projects, count, page, limit });
  } catch (err) { next(err); }
};

export const getProjectDetail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: String(req.params.projectId) },
      include: { developer: { select: { id: true, name: true, email: true } }, lands: true }
    });
    if (!project) return error(res, 'Not found', 404);
    return success(res, { project });
  } catch (err) { next(err); }
};

export const createProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, description, location, state, district, tags, landIds } = req.body;
    if (!title || !description || !location || !state || !district) return error(res, 'Missing required fields', 400);

      if (landIds !== undefined && (!Array.isArray(landIds) || landIds.some((id: unknown) => typeof id !== 'string'))) return error(res, 'landIds must be an array of land record IDs', 400);
      const linked = landIds ? await prisma.land.findMany({
        where: {
          id: { in: landIds }, ownerId: req.user!.id, status: 'VERIFIED', lockTransferId: null,
          encumbrances: { none: { active: true } },
          disputes: { none: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
        },
        select: { id: true },
      }) : [];
      if (landIds && (new Set(landIds).size !== landIds.length || linked.length !== landIds.length)) return error(res, 'Only verified, unencumbered, undisputed land owned by the developer can be linked', 400);

      const project = await prisma.project.create({
      data: {
        title, description, location, state, district,
        tags: tags || [],
        developerId: req.user!.id,
        lands: landIds ? { connect: landIds.map((id: string) => ({ id })) } : undefined
      }
    });
    return success(res, { project }, 'Created successfully', 201);
  } catch (err) { next(err); }
};

export const updateProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = String(req.params.projectId);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return error(res, 'Not found', 404);
    if (project.developerId !== req.user!.id && req.user!.role !== 'ADMIN') return error(res, 'Forbidden', 403);

    const { title, description, location, state, district, tags, status, imageUrl, coverImageUrl, wizardStep, infrastructure, landIds } = req.body;
    if (status !== undefined && !['PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED'].includes(status)) return error(res, 'Invalid project status', 400);
    if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 160)) return error(res, 'Project title is invalid', 400);
    if (description !== undefined && (typeof description !== 'string' || description.length > 10000)) return error(res, 'Project description is invalid', 400);
    if (landIds !== undefined && (!Array.isArray(landIds) || landIds.some((id: unknown) => typeof id !== 'string'))) return error(res, 'landIds must be an array of land record IDs', 400);
    if (landIds !== undefined) {
      if (new Set(landIds).size !== landIds.length) return error(res, 'landIds cannot contain duplicates', 400);
      const eligibleLands = await prisma.land.findMany({
        where: {
          id: { in: landIds }, ownerId: req.user!.id, status: 'VERIFIED', lockTransferId: null,
          encumbrances: { none: { active: true } },
          disputes: { none: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } },
        },
        select: { id: true },
      });
      if (eligibleLands.length !== landIds.length) return error(res, 'Only verified, unencumbered, undisputed land owned by the developer can be linked', 400);
    }
    const updated = await prisma.project.update({
      where: { id: projectId },
      data: {
        ...(title !== undefined ? { title: title.trim() } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(location !== undefined ? { location } : {}),
        ...(state !== undefined ? { state } : {}),
        ...(district !== undefined ? { district } : {}),
        ...(tags !== undefined ? { tags } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
        ...(wizardStep !== undefined ? { wizardStep } : {}),
        ...(infrastructure !== undefined ? { infrastructure } : {}),
        ...(landIds !== undefined ? { lands: { set: landIds.map((id: string) => ({ id })) } } : {}),
      },
    });
    return success(res, { project: updated }, 'Updated successfully');
  } catch (err) { next(err); }
};

export const deleteProject = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const projectId = String(req.params.projectId);
    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return error(res, 'Not found', 404);
    if (project.developerId !== req.user!.id && req.user!.role !== 'ADMIN') return error(res, 'Forbidden', 403);

    await prisma.project.delete({ where: { id: projectId } });
    return success(res, null, 'Deleted successfully');
  } catch (err) { next(err); }
};
