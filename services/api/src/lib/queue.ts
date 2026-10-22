type JobHandler = (data: Record<string, unknown>) => Promise<void>;

const handlers = new Map<string, JobHandler>();
const memoryQueue: Array<{ name: string; data: Record<string, unknown> }> = [];
let bullQueue: { add: (name: string, data: Record<string, unknown>) => Promise<unknown> } | null = null;
let initTried = false;

export function registerWorker(name: string, handler: JobHandler) {
  handlers.set(name, handler);
}

async function initBull() {
  if (initTried) return bullQueue;
  initTried = true;
  if (!process.env.REDIS_URL) return null;
  try {
    const { Queue, Worker } = await import('bullmq');
    const connection = { url: process.env.REDIS_URL };
    bullQueue = new Queue('blockland-docs', { connection });
    new Worker(
      'blockland-docs',
      async (job: { name: string; data: Record<string, unknown> }) => {
        const handler = handlers.get(job.name);
        if (handler) await handler(job.data);
      },
      { connection }
    );
    return bullQueue;
  } catch (err) {
    console.warn('[queue] BullMQ unavailable, using in-process queue', err);
    bullQueue = null;
    return null;
  }
}

export async function enqueue(name: string, data: Record<string, unknown>) {
  const q = await initBull();
  if (q) {
    await q.add(name, data);
    return;
  }
  memoryQueue.push({ name, data });
  setImmediate(async () => {
    const handler = handlers.get(name);
    if (handler) {
      try {
        await handler(data);
      } catch (err) {
        console.error('[queue:demo]', err);
      }
    }
  });
}
