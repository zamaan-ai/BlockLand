import { Request } from 'express';

export function hasActiveRole(req: Request, roles: string[]): boolean {
  return Boolean(req.user && roles.includes(req.user.role));
}

export function isWithinActiveJurisdiction(req: Request, state: string): boolean {
  if (req.user?.role === 'ADMIN') return true;
  if (req.user?.role !== 'GOVERNMENT') return false;
  const jurisdiction = req.roleAssignment?.jurisdiction;
  return jurisdiction === '*' || Boolean(jurisdiction && jurisdiction.toLowerCase() === state.toLowerCase());
}
