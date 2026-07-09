import { Queue, QueueEvents } from 'bullmq';
import { env } from '../config/env';
import { createBullConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';

export const QUEUE_NAMES = [
  'text',
  'image',
  'embedding',
  'ocr',
  'seo',
  'translation',
  'classification',
] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

const connection = createBullConnection();

const queues = new Map<QueueName, Queue>();
const queueEvents = new Map<QueueName, QueueEvents>();

export function getQueue(name: QueueName): Queue {
  let queue = queues.get(name);
  if (!queue) {
    queue = new Queue(name, {
      connection,
      prefix: env.QUEUE_PREFIX,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: false, // dead letter: jobs com falha ficam para inspecao
      },
    });
    queues.set(name, queue);
  }
  return queue;
}

export function getQueueEvents(name: QueueName): QueueEvents {
  let events = queueEvents.get(name);
  if (!events) {
    events = new QueueEvents(name, { connection: createBullConnection(), prefix: env.QUEUE_PREFIX });
    queueEvents.set(name, events);
  }
  return events;
}

export interface EnqueueOptions {
  tenantId?: string;
  projectId?: string;
  priority?: number;
  delayMs?: number;
}

export async function enqueue(
  name: QueueName,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
): Promise<string> {
  const record = await prisma.job.create({
    data: {
      tenantId: opts.tenantId,
      projectId: opts.projectId,
      queue: name,
      type: name,
      status: 'waiting',
      priority: opts.priority ?? 5,
      payload: payload as object,
    },
  });
  try {
    await getQueue(name).add(
      name,
      { ...payload, __jobId: record.id, __tenantId: opts.tenantId, __projectId: opts.projectId },
      { jobId: record.id, priority: opts.priority ?? 5, delay: opts.delayMs },
    );
    return record.id;
  } catch (err) {
    await prisma.job.update({
      where: { id: record.id },
      data: { status: 'failed', error: err instanceof Error ? err.message.slice(0, 2000) : String(err).slice(0, 2000), finishedAt: new Date() },
    }).catch(() => undefined);
    throw err;
  }
}

/** Enfileira e aguarda o resultado (com timeout). */
export async function enqueueAndWait<T = unknown>(
  name: QueueName,
  payload: Record<string, unknown>,
  opts: EnqueueOptions & { timeoutMs?: number } = {},
): Promise<{ jobId: string; result: T }> {
  const jobId = await enqueue(name, payload, opts);
  const events = getQueueEvents(name);
  const job = await getQueue(name).getJob(jobId);
  if (!job) throw new Error(`job ${jobId} not found after enqueue`);
  const result = (await job.waitUntilFinished(events, opts.timeoutMs ?? env.JOB_WAIT_TIMEOUT_MS)) as T;
  return { jobId, result };
}

export async function queueStats(): Promise<
  Array<{ name: QueueName; waiting: number; active: number; completed: number; failed: number; delayed: number }>
> {
  const stats = [];
  for (const name of QUEUE_NAMES) {
    const counts = await getQueue(name).getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
    stats.push({
      name,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
    });
  }
  return stats;
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    ...Array.from(queueEvents.values()).map((events) => events.close()),
    ...Array.from(queues.values()).map((queue) => queue.close()),
  ]);
  queueEvents.clear();
  queues.clear();
}