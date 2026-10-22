type CacheEntry = { value: unknown; expiresAt: number };

const memory = new Map<string, CacheEntry>();

let redis: any = null;
let redisReady = false;

async function getRedis() {
  if (redisReady) return redis;
  redisReady = true;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const Redis = (await import('ioredis')).default;
    redis = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
    await (redis as unknown as { connect: () => Promise<void> }).connect();
    return redis;
  } catch {
    redis = null;
    return null;
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const client = await getRedis();
  if (client) {
    const raw = await client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  const entry = memory.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memory.delete(key);
    return null;
  }
  return entry.value as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 60) {
  const client = await getRedis();
  if (client) {
    await client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    return;
  }
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDel(key: string) {
  const client = await getRedis();
  if (client) {
    await client.del(key);
    return;
  }
  memory.delete(key);
}

export function cacheWrap<T>(key: string, ttlSeconds: number, fn: () => Promise<T>) {
  return (async () => {
    const hit = await cacheGet<T>(key);
    if (hit !== null) return hit;
    const value = await fn();
    await cacheSet(key, value, ttlSeconds);
    return value;
  })();
}
