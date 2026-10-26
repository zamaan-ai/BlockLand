import { Request, Response, NextFunction } from 'express';
import { error } from '../lib/response';
import { verifyAccessToken } from '../lib/jwt';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function userRateLimit(max = 60, windowMs = 60_000) {
  return (req: Request, res: Response, next: NextFunction): void => {
    let userId = req.user?.id;
    if (!userId && req.headers.authorization?.startsWith('Bearer ')) {
      try {
        userId = verifyAccessToken(req.headers.authorization.split(' ')[1]).userId;
      } catch {
        userId = undefined;
      }
    }
    const key = userId ? `user:${userId}` : `ip:${req.ip}`;
    const now = Date.now();
    const existing = buckets.get(key);
    if (!existing || now > existing.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    existing.count += 1;
    if (existing.count > max) {
      const retry = Math.ceil((existing.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      error(res, 'Too many requests for this account', 429);
      return;
    }
    next();
  };
}
