import { Request, Response } from 'express';

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    userRoleAssignment: { findMany: jest.fn(), createMany: jest.fn() },
  },
}));

jest.mock('../src/lib/jwt', () => ({
  verifyAccessToken: jest.fn(),
}));

import prisma from '../src/lib/prisma';
import { verifyAccessToken } from '../src/lib/jwt';
import { authenticate } from '../src/middleware/auth';

const db = prisma as unknown as {
  user: { findUnique: jest.Mock };
  userRoleAssignment: { findMany: jest.Mock; createMany: jest.Mock };
};
const verifyTokenMock = verifyAccessToken as jest.Mock;

function makeResponse() {
  const response = { status: jest.fn(), json: jest.fn() };
  response.status.mockReturnValue(response);
  return response as unknown as Response & typeof response;
}

describe('authentication role assignment migration', () => {
  beforeEach(() => jest.clearAllMocks());

  it('does not recreate roles after every assignment has been revoked', async () => {
    verifyTokenMock.mockReturnValue({ userId: 'account-1', role: 'ADMIN' });
    db.user.findUnique.mockResolvedValue({ id: 'account-1', isActive: true, role: 'ADMIN' });
    db.userRoleAssignment.findMany.mockResolvedValue([{ userId: 'account-1', role: 'ADMIN', active: false }]);
    const req = { headers: { authorization: 'Bearer revoked-token' } } as unknown as Request;
    const res = makeResponse();
    const next = jest.fn();

    await authenticate(req, res, next);

    expect(db.userRoleAssignment.createMany).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
