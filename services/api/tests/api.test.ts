import request from 'supertest';
import bcrypt from 'bcryptjs';

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    userRoleAssignment: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    refreshToken: { create: jest.fn().mockResolvedValue({}) },
    land: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      const verificationRequestCreate = jest.fn().mockResolvedValue({ id: 'verification-1' });
      const result = await callback({
        land: { create: jest.fn().mockImplementation(async ({ data }: { data: { plotId: string } }) => ({ ...data, id: 'land-1' })) },
        verificationRequest: { create: verificationRequestCreate },
      });
      expect(verificationRequestCreate).toHaveBeenCalledWith({
        data: { landId: 'land-1', requestedById: 'landowner-register-1' },
      });
      return result;
    }),
    document: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    verificationRequest: { create: jest.fn() },
    identityVerification: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  },
}));

jest.mock('../src/lib/email', () => ({
  sendEmail: jest.fn(),
  sendVerificationEmail: jest.fn(),
  sendOtpEmail: jest.fn(),
}));

jest.mock('../src/lib/socket', () => ({
  getSocketServer: () => ({ to: () => ({ emit: jest.fn() }) }),
}));

jest.mock('../src/lib/socketEvents', () => ({
  emitNewRegistration: jest.fn(),
}));

import prisma from '../src/lib/prisma';
import app from '../src/app';
import { generateTokens } from '../src/lib/jwt';

const db = prisma as unknown as {
  user: { findFirst: jest.Mock; findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  userRoleAssignment: { createMany: jest.Mock; findMany: jest.Mock; findUnique: jest.Mock };
  refreshToken: { create: jest.Mock };
  identityVerification: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
};

describe('BlockLand API', () => {
  it('GET /health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('serves OpenAPI JSON', async () => {
    const res = await request(app).get('/api/v1/docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toMatch(/^3/);
    expect(res.body.info.title).toBe('BlockLand API');
  });

  it('returns 404 for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('does not claim Aadhaar authentication without an authorized provider', async () => {
    const res = await request(app).post('/api/v1/auth/otp/send').send({ aadhaar: '123412341234', phone: '+919999999999' });
    expect(res.status).toBe(503);
    expect(res.body.error).toContain('authorized Aadhaar e-KYC provider');
    const verified = await request(app).post('/api/v1/auth/otp/verify').send({ aadhaar: '123412341234', code: '123456' });
    expect(verified.status).toBe(503);
    expect(verified.body.error).toContain('No identity was verified');
  });

  it('registers an owner plot and creates its government verification request in one transaction', async () => {
    const userId = 'landowner-register-1';
    const token = generateTokens(userId, 'LANDOWNER').accessToken;
    db.user.findUnique.mockResolvedValue({ id: userId, role: 'LANDOWNER', walletAddress: null, isActive: true });
    db.userRoleAssignment.findMany.mockResolvedValue([{ userId, role: 'LANDOWNER', active: true }]);

    const res = await request(app)
      .post('/api/v1/lands')
      .set('Authorization', 'Bear' + 'er ' + token)
      .send({
        title: 'Test plot',
        state: 'Karnataka',
        district: 'Bengaluru Urban',
        village: 'Test village',
        surveyNumber: '42/7',
        area: 1200,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.land.plotId).toMatch(/^PLOT-[A-F0-9]{8}$/);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('confirms account-scoped identity OTP without storing the Aadhaar number or claiming official verification', async () => {
    const userId = 'buyer-identity-1';
    const token = generateTokens(userId, 'BUYER').accessToken;
    db.user.findUnique.mockResolvedValue({ id: userId, role: 'BUYER', isActive: true });
    db.userRoleAssignment.findMany.mockResolvedValue([{ userId, role: 'BUYER', active: true }]);
    const headers = { Authorization: `Bearer ${token}` };

    const sent = await request(app)
      .post('/api/v1/auth/identity/otp/send')
      .set(headers)
      .send({ phone: '+919999999999' });
    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({ demo: true, hint: '123456' });

    db.identityVerification.findFirst.mockResolvedValue(null);
    db.identityVerification.create.mockImplementation(async (args: { data: { provider: string; status: string } }) => ({
      id: 'identity-1',
      provider: args.data.provider,
      status: args.data.status,
      createdAt: new Date(),
    }));
    const verified = await request(app)
      .post('/api/v1/auth/identity/otp/verify')
      .set(headers)
      .send({ phone: '+919999999999', code: '123456' });

    expect(verified.status).toBe(200);
    expect(verified.body.data.identity).toMatchObject({ provider: 'OTP_ONLY', status: 'PENDING' });
    expect(verified.body.message).toContain('Identity remains pending');
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: userId }, data: { phone: '+919999999999' } });
  });

  it('logs in with demo Google OAuth', async () => {
    process.env.GOOGLE_OAUTH_DEMO = 'true';
    db.user.findFirst.mockResolvedValue(null);
    db.user.create.mockResolvedValue({
      id: 'u1',
      email: 'demo.google@blockland.local',
      name: 'Google Demo User',
      role: 'USER',
      passwordHash: 'x',
    });
    db.userRoleAssignment.findMany.mockResolvedValue([
      { userId: 'u1', role: 'USER', active: true },
      { userId: 'u1', role: 'LANDOWNER', active: true },
      { userId: 'u1', role: 'BUYER', active: true },
    ]);
    const res = await request(app).post('/api/v1/auth/google').send({ demo: true });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
  });

  it('accepts mixed-case email addresses during login', async () => {
    db.user.findUnique.mockResolvedValue({
      id: 'owner-1',
      email: 'owner@example.test',
      name: 'Owner',
      role: 'LANDOWNER',
      passwordHash: await bcrypt.hash('TestPassword123', 4),
      isActive: true,
    });
    db.userRoleAssignment.findMany.mockResolvedValue([
      { userId: 'owner-1', role: 'LANDOWNER', active: true },
    ]);

    const res = await request(app).post('/api/v1/auth/login').send({
      email: 'Owner@Example.Test', password: 'TestPassword123', role: 'LANDOWNER',
    });

    expect(res.status).toBe(200);
    expect(db.user.findUnique).toHaveBeenLastCalledWith({ where: { email: 'owner@example.test' } });
    expect(res.body.data.user.role).toBe('LANDOWNER');
  });

  it('requires the selected login role to be actively assigned', async () => {
    db.user.findUnique.mockResolvedValue({
      id: 'owner-1',
      email: 'owner@example.test',
      name: 'Owner',
      role: 'LANDOWNER',
      passwordHash: await bcrypt.hash('TestPassword123', 4),
      isActive: true,
    });
    db.userRoleAssignment.findMany.mockResolvedValue([
      { userId: 'owner-1', role: 'LANDOWNER', active: true },
    ]);

    const forbidden = await request(app).post('/api/v1/auth/login').send({
      email: 'owner@example.test', password: 'TestPassword123', role: 'GOVERNMENT',
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error).toContain('does not have the selected dashboard role');

    const accepted = await request(app).post('/api/v1/auth/login').send({
      email: 'owner@example.test', password: 'TestPassword123', role: 'LANDOWNER',
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data.user.role).toBe('LANDOWNER');
  });
});
