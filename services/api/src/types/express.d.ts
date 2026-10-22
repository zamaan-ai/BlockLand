import { User, UserRoleAssignment } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: User & { roleAssignments?: UserRoleAssignment[] };
      roleAssignment?: UserRoleAssignment;
    }
  }
}
