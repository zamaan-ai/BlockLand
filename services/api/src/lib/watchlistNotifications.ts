import { Prisma } from '@prisma/client';

type WatchlistNotificationClient = Pick<Prisma.TransactionClient, 'savedLand' | 'notification'>;

export async function notifySavedPropertyWatchers(
  db: WatchlistNotificationClient,
  landId: string,
  type: string,
  title: string,
  message: string,
  excludedUserIds: string[] = [],
) {
  const savedBy = await db.savedLand.findMany({ where: { landId }, select: { userId: true } });
  const userIds = [...new Set(savedBy.map((entry) => entry.userId))].filter((userId) => !excludedUserIds.includes(userId));
  if (!userIds.length) return;
  await db.notification.createMany({ data: userIds.map((userId) => ({ userId, type, title, message })) });
}
