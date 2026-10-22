import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { generateTokens } from '../lib/jwt';
import { success, error } from '../lib/response';
import { logAction } from '../lib/auditLogger';
import { sendVerificationEmail } from '../lib/email';
import { cacheGet, cacheSet, cacheDel } from '../lib/cache';
import { Role } from '@prisma/client';

function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

async function ensureUserRoles(user: { id: string; role: 'USER' | 'LANDOWNER' | 'BUYER' | 'DEVELOPER' | 'GOVERNMENT' | 'ADMIN' }) {
  const existing = await prisma.userRoleAssignment.findMany({ where: { userId: user.id } });
  if (existing.length) return existing.filter((assignment) => assignment.active);
  const roles = user.role === 'USER'
    ? ['USER', 'LANDOWNER', 'BUYER'] as const
    : [user.role] as const;
  await prisma.userRoleAssignment.createMany({
    data: roles.map((role) => ({ userId: user.id, role, active: true })),
    skipDuplicates: true,
  });
  return prisma.userRoleAssignment.findMany({ where: { userId: user.id, active: true }, orderBy: { createdAt: 'asc' } });
}

async function issueSession(user: { id: string; role: 'USER' | 'LANDOWNER' | 'BUYER' | 'DEVELOPER' | 'GOVERNMENT' | 'ADMIN'; passwordHash: string }, activeRole = user.role) {
  const assignments = await ensureUserRoles(user);
  const role = assignments.find((assignment) => assignment.role === activeRole)?.role;
  if (!role) throw new Error('Requested dashboard role is not assigned to this account');
  const { accessToken, refreshToken } = generateTokens(user.id, role);
  await prisma.refreshToken.create({
    data: { token: refreshToken, userId: user.id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
  });
  return { accessToken, refreshToken, roles: assignments };
}

function stripUser<T extends { passwordHash: string }>(user: T) {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

export const register = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const name = typeof req.body.name === 'string' ? req.body.name : '';
    const phone = req.body.phone;
    const aadhaarNumber = req.body.aadhaarNumber;
    const requestedRole = String(req.body.role || 'LANDOWNER').toUpperCase();
    if (!['LANDOWNER', 'BUYER', 'GOVERNMENT'].includes(requestedRole)) return error(res, 'Choose Landowner, Buyer, or Government officer', 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(res, 'A valid email address is required', 400);
    if (!name.trim() || name.trim().length > 120) return error(res, 'Name is required and must be at most 120 characters', 400);
    if (password.length < 8 || password.length > 128) return error(res, 'Password must contain 8 to 128 characters', 400);
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return error(res, 'Email already in use', 400);

    const passwordHash = await bcrypt.hash(password, 10);
    const role: Role = requestedRole === 'GOVERNMENT' ? 'USER' : requestedRole as Role;
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email, passwordHash, name: name.trim(), phone, aadhaarNumber, role },
      });
      await tx.userRoleAssignment.create({
        data: { userId: created.id, role, active: true },
      });
      if (requestedRole === 'GOVERNMENT') {
        await tx.userRoleAssignment.create({
          data: { userId: created.id, role: 'GOVERNMENT', active: false },
        });
      }
      return created;
    });

    const verifyToken = crypto.randomBytes(24).toString('hex');
    await cacheSet(`email-verify:${verifyToken}`, { userId: user.id }, 60 * 60 * 24);
    await sendVerificationEmail(user.email, verifyToken);

    const tokens = await issueSession(user, role);
    await logAction('USER_REGISTER', user.id, 'User', user.id, { email: user.email, requestedRole });
    const message = requestedRole === 'GOVERNMENT'
      ? 'Account created. Government officer access is pending administrator approval.'
      : 'Registered successfully';
    return success(res, { user: { ...stripUser(user), role, roles: tokens.roles }, ...tokens, requestedRole, roleRequestPending: requestedRole === 'GOVERNMENT' }, message, 201);
  } catch (err) {
    next(err);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return error(res, 'Invalid credentials', 401);
    }
    if (!user.isActive) return error(res, 'Account inactive', 403);

    const requestedRole = req.body.role as string | undefined;
    const assignments = await ensureUserRoles(user);
    if (!assignments.length) return error(res, 'No active roles are assigned to this account. Contact an administrator.', 403);
    if (requestedRole && !['USER', 'LANDOWNER', 'BUYER', 'DEVELOPER', 'GOVERNMENT', 'ADMIN'].includes(requestedRole)) {
      return error(res, 'Choose a valid dashboard role', 400);
    }
    if (requestedRole && !assignments.some((assignment) => assignment.role === requestedRole)) {
      const requestedAssignment = await prisma.userRoleAssignment.findUnique({
        where: { userId_role: { userId: user.id, role: requestedRole as typeof user.role } },
        select: { active: true, grantedById: true },
      });
      if (requestedRole === 'GOVERNMENT' && requestedAssignment && !requestedAssignment.active && !requestedAssignment.grantedById) {
        return error(res, 'Government officer access is awaiting administrator approval.', 403);
      }
      return error(res, 'This account does not have the selected dashboard role.', 403);
    }
    const role = requestedRole
      ? requestedRole as typeof user.role
      : assignments.some((assignment) => assignment.role === 'LANDOWNER')
        ? 'LANDOWNER'
        : assignments[0]?.role || user.role;
    const tokens = await issueSession(user, role);
    return success(res, { user: { ...stripUser(user), role, roles: tokens.roles }, ...tokens }, 'Logged in successfully');
  } catch (err) {
    next(err);
  }
};

export const me = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = req.user!;
    return success(res, { user: { ...stripUser(user), roleAssignments: user.roleAssignments, activeRole: user.role } });
  } catch (err) {
    next(err);
  }
};

export const switchRole = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const requestedRole = String(req.body.role || '');
    const assignment = req.user!.roleAssignments?.find((entry) => entry.role === requestedRole && entry.active);
    if (!assignment) return error(res, 'Role is not assigned to this account', 403);
    const tokens = await issueSession(req.user!, assignment.role);
    await logAction('ROLE_SWITCHED', req.user!.id, 'User', req.user!.id, { fromRole: req.user!.role, toRole: assignment.role });
    return success(res, { user: { ...stripUser(req.user!), role: assignment.role, roles: tokens.roles }, ...tokens }, 'Dashboard role switched');
  } catch (err) {
    next(err);
  }
};

export const connectWallet = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletAddress } = req.body;
    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: { walletAddress },
    });
    return success(res, { user: stripUser(user) }, 'Wallet connected');
  } catch (err) {
    next(err);
  }
};

export const verifyEmail = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const token = String(req.query.token || req.body.token || '');
    const payload = await cacheGet<{ userId: string }>(`email-verify:${token}`);
    if (!payload) return error(res, 'Invalid or expired verification token', 400);
    const user = await prisma.user.update({
      where: { id: payload.userId },
      data: { emailVerified: true, isVerified: true },
    });
    await cacheDel(`email-verify:${token}`);
    return success(res, { user: stripUser(user) }, 'Email verified');
  } catch (err) {
    next(err);
  }
};

export const googleAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idToken, demo, email, name } = req.body as {
      idToken?: string;
      demo?: boolean;
      email?: string;
      name?: string;
    };

    let profile: { email: string; name: string; sub: string };

    if (idToken && process.env.GOOGLE_CLIENT_ID) {
      const resGoogle = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
      if (!resGoogle.ok) return error(res, 'Invalid Google token', 401);
      const data = (await resGoogle.json()) as { aud?: string; email?: string; name?: string; sub?: string };
      if (data.aud !== process.env.GOOGLE_CLIENT_ID || !data.email || !data.sub) {
        return error(res, 'Google audience mismatch', 401);
      }
      profile = { email: normalizeEmail(data.email), name: data.name || data.email, sub: data.sub };
    } else if (demo || process.env.GOOGLE_OAUTH_DEMO === 'true') {
      const normalizedEmail = normalizeEmail(email || 'demo.google@blockland.local');
      profile = {
        email: normalizedEmail,
        name: name || 'Google Demo User',
        sub: `demo-${normalizedEmail.replace(/[^a-z0-9]/gi, '')}`,
      };
    } else {
      return error(res, 'Google OAuth is not configured', 400);
    }

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: profile.sub }, { email: profile.email }] },
    });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email: profile.email,
          name: profile.name,
          googleId: profile.sub,
          passwordHash: await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10),
          emailVerified: true,
          isVerified: true,
        },
      });
    } else if (!user.googleId) {
      user = await prisma.user.update({ where: { id: user.id }, data: { googleId: profile.sub, emailVerified: true } });
    }

    const assignments = await ensureUserRoles(user);
    if (!assignments.length) return error(res, 'No active roles are assigned to this account. Contact an administrator.', 403);
    const activeRole = assignments.some((assignment) => assignment.role === 'LANDOWNER') ? 'LANDOWNER' : assignments[0].role;
    const tokens = await issueSession(user, activeRole);
    await logAction('GOOGLE_LOGIN', user.id, 'User', user.id, { email: user.email });
    return success(res, { user: { ...stripUser(user), role: activeRole, roles: tokens.roles }, ...tokens }, 'Logged in with Google');
  } catch (err) {
    next(err);
  }
};

export const sendAadhaarOtp = (_req: Request, res: Response) => {
  return error(res, 'Aadhaar authentication is unavailable until an authorized Aadhaar e-KYC provider is configured. Phone OTP cannot authenticate Aadhaar.', 503);
};

export const verifyAadhaarOtp = (_req: Request, res: Response) => {
  return error(res, 'Aadhaar authentication is unavailable until an authorized Aadhaar e-KYC provider is configured. No identity was verified.', 503);
};
