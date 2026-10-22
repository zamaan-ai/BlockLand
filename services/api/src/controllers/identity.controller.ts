import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { cacheDel, cacheGet, cacheSet } from '../lib/cache';
import { issueOtp, verifyOtp } from '../lib/otp';
import { error, success } from '../lib/response';

const OTP_COOLDOWN_SECONDS = 60;
const OTP_ATTEMPT_LIMIT = 5;
const OTP_RATE_KEY = (userId: string) => `identity-otp-rate:${userId}`;
const OTP_ATTEMPT_KEY = (userId: string) => `identity-otp-attempts:${userId}`;

export const sendIdentityOtp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const phone = String(req.body.phone || '').trim();
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) return error(res, 'Enter a phone number in international format, such as +919876543210', 400);

    const userId = req.user!.id;
    if (await cacheGet(OTP_RATE_KEY(userId))) return error(res, 'Please wait one minute before requesting another OTP', 429);

    const result = await issueOtp({ target: phone, phone, userId });
    await cacheSet(OTP_RATE_KEY(userId), true, OTP_COOLDOWN_SECONDS);
    await cacheDel(OTP_ATTEMPT_KEY(userId));
    return success(res, result, result.demo
      ? 'Demo OTP prepared. This does not verify identity with UIDAI.'
      : 'OTP sent by SMS. This does not verify identity with UIDAI.');
  } catch (err) {
    next(err);
  }
};

export const verifyIdentityOtp = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const phone = String(req.body.phone || '').trim();
    const code = String(req.body.code || '').trim();
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) return error(res, 'Enter the phone number used to request the OTP', 400);
    if (!/^\d{6}$/.test(code)) return error(res, 'OTP must contain exactly 6 digits', 400);

    const userId = req.user!.id;
    const attempts = await cacheGet<number>(OTP_ATTEMPT_KEY(userId)) || 0;
    if (attempts >= OTP_ATTEMPT_LIMIT) return error(res, 'Too many incorrect OTP attempts. Request a new code and try again.', 429);
    const verified = await verifyOtp(phone, code, userId);
    if (!verified) {
      await cacheSet(OTP_ATTEMPT_KEY(userId), attempts + 1, 10 * 60);
      return error(res, 'Invalid or expired OTP', 401);
    }
    await cacheDel(OTP_RATE_KEY(userId));
    await cacheDel(OTP_ATTEMPT_KEY(userId));
    await prisma.user.update({ where: { id: userId }, data: { phone } });

    const previous = await prisma.identityVerification.findFirst({
      where: { userId, provider: 'OTP_ONLY' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const reference = `OTP-${Date.now().toString(36).toUpperCase()}`;
    const identity = previous
      ? await prisma.identityVerification.update({
          where: { id: previous.id },
          data: { provider: 'OTP_ONLY', reference, status: 'PENDING', verifiedAt: null, expiresAt: null },
          select: { id: true, provider: true, status: true, createdAt: true },
        })
      : await prisma.identityVerification.create({
          data: { userId, provider: 'OTP_ONLY', reference, status: 'PENDING' },
          select: { id: true, provider: true, status: true, createdAt: true },
        });

    return success(res, { identity }, 'Phone OTP confirmed. Identity remains pending until an approved identity provider verifies it.');
  } catch (err) {
    next(err);
  }
};
