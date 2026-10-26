import prisma from './prisma';
import { FraudSeverity } from '@prisma/client';

export async function runFraudChecks(landId: string, reporterId?: string) {
  const land = await prisma.land.findUnique({ where: { id: landId }, include: { documents: true, transfers: true, owner: true } });
  if (!land) return [];
  const reasons: Array<{ reason: string; severity: FraudSeverity }> = [];
  const hashes = land.documents.map(d => d.sha256Hash);
  if (new Set(hashes).size !== hashes.length) reasons.push({ reason: 'Duplicate document hash attached to the same land record', severity: FraudSeverity.HIGH });
  const activeAttempts = land.transfers.filter(t => ['INITIATED', 'LOCKED', 'ESCROW_FUNDED', 'UNDER_REVIEW', 'APPROVED'].includes(t.status)).length;
  if (activeAttempts > 1) reasons.push({ reason: 'Multiple active transfer attempts detected', severity: FraudSeverity.CRITICAL });
  if (!land.owner?.walletAddress) reasons.push({ reason: 'Registered owner has no linked wallet', severity: FraudSeverity.MEDIUM });
  const created = [];
  for (const item of reasons) {
    const existing = await prisma.fraudFlag.findFirst({ where: { landId, reason: item.reason, status: { in: ['OPEN', 'UNDER_REVIEW'] } } });
    if (!existing) created.push(await prisma.fraudFlag.create({ data: { landId, reason: item.reason, severity: item.severity, reportedById: reporterId } }));
  }
  if (created.some(x => x.severity === 'HIGH' || x.severity === 'CRITICAL')) await prisma.land.update({ where: { id: landId }, data: { status: 'UNDER_REVIEW' } });
  return created;
}
