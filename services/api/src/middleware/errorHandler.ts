import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { JsonWebTokenError } from 'jsonwebtoken';
import { error as sendError } from '../lib/response';

export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction): void => {
  console.error(err);

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      sendError(res, 'Unique constraint failed', 409, { target: err.meta?.target });
      return;
    }
    if (err.code === 'P2025') {
      sendError(res, 'Record not found', 404);
      return;
    }
  }

  if (err instanceof ZodError) {
    sendError(res, 'Validation failed', 422, err.errors);
    return;
  }

  if (err instanceof JsonWebTokenError) {
    sendError(res, 'Invalid token', 401);
    return;
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  sendError(res, message, statusCode, process.env.NODE_ENV === 'development' ? err.stack : undefined);
};
