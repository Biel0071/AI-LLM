import { Queue, QueueEvents } from 'bullmq';
import { env } from '../config/env';
import { createBullConnection } from '../lib/redis';
import { prisma } from '../lib/prisma';
import { cacheKey } from '@ai-platform/shared';

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
        // Mantem uma dead letter util sem deixar falhas crescerem para sempre
        // dentro do Redis. O historico duravel continua no Postgres.
        removeOnFail: { age: 7 * 24 * 3600, count: 2000 },
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
  const shouldDeduplicate = payload.cache !== false;
  const dedupKey = shouldDeduplicate
    ? cacheKey('job', name, `${opts.tenantId ?? 'global'}:${opts.projectId ?? 'all'}`, payload)
    : undefined;

  const data = {
    tenantId: opts.tenantId,
    projectId: opts.projectId,
    queue: name,
    type: name,
    status: 'waiting',
    priority: opts.priority ?? 5,
    dedupKey,
    payload: payload as object,
  };

  let record: { id: string };
  if (dedupKey) {
    // Caminho rapido para cache hit: evita abrir uma transacao quando o job
    // ja existe. O advisory lock abaixo continua fechando a corrida no miss.
    const existing = await prisma.job.findFirst({
      where: { dedupKey, status: { in: ['waiting', 'active', 'completed'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (existing) return existing.id;

    const claimed = await prisma.$transaction(async (tx) => {
      // Serializa somente requests com o mesmo hash. Isso fecha a janela em
      // que um lote concorrente criava varios jobs iguais antes do primeiro
      // INSERT ficar visivel, desperdicando provider/tokens.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dedupKey}))`;
      const existing = await tx.job.findFirst({
        where: { dedupKey, status: { in: ['waiting', 'active', 'completed'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (existing) return { record: existing, created: false };
      return { record: await tx.job.create({ data, select: { id: true } }), created: true };
    });
    if (!claimed.created) return claimed.record.id;
    record = claimed.record;
  } else {
    record = await prisma.job.create({ data, select: { id: true } });
  }
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
  Array<{ name: QueueName; waiting: number; active: number; completed: number; failed: number; delayed: number; prioritized: number;
    concurrency: number; averageJobMs: number; queued: number; estimatedDrainMs: number }>
> {
  return Promise.all(QUEUE_NAMES.map(async (name) => {
    const [counts, averageJobMs] = await Promise.all([
      getQueue(name).getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'prioritized'), averageJobDuration(name),
    ]);
    const concurrency = concurrencyFor(name);
    const queued = (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0) + (counts.prioritized ?? 0);
    return {
      name,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      delayed: counts.delayed ?? 0,
      prioritized: counts.prioritized ?? 0,
      concurrency, averageJobMs, queued,
      estimatedDrainMs: Math.ceil(queued / concurrency) * averageJobMs,
    };
  }));
}

export async function closeQueues(): Promise<void> {
  await Promise.all([
    ...Array.from(queueEvents.values()).map((events) => events.close()),
    ...Array.from(queues.values()).map((queue) => queue.close()),
  ]);
  queueEvents.clear();
  queues.clear();
}
export interface QueueTiming {
  queue: QueueName;
  state: string;
  concurrency: number;
  position: number;
  jobsAhead: number;
  averageJobMs: number;
  estimatedWaitMs: number;
  estimatedCompletionMs: number;
  estimatedStartAt: string;
  estimatedFinishAt: string;
  approximate: true;
}

function concurrencyFor(name: QueueName): number {
  const configured = name === 'image'
    ? process.env.IMAGE_WORKER_CONCURRENCY ?? '1'
    : process.env.WORKER_CONCURRENCY ?? String(env.WORKER_CONCURRENCY);
  return Math.max(1, Number(configured) || 1);
}

function fallbackDurationFor(name: QueueName): number {
  if (name === 'image') return 35_000;
  if (name === 'ocr') return 15_000;
  return 7_000;
}

async function averageJobDuration(name: QueueName): Promise<number> {
  const recent = await prisma.job.findMany({
    where: { queue: name, status: 'completed', durationMs: { not: null } },
    orderBy: { finishedAt: 'desc' }, take: 20, select: { durationMs: true },
  });
  const durations = recent.map((job) => job.durationMs)
    .filter((duration): duration is number => typeof duration === 'number' && duration > 0)
    .sort((a, b) => a - b);
  if (!durations.length) return fallbackDurationFor(name);
  const middle = Math.floor(durations.length / 2);
  return durations.length % 2 ? durations[middle] : Math.round((durations[middle - 1] + durations[middle]) / 2);
}

/** Estimativa operacional; prioridade e retries podem alterar a ordem real. */
export async function queueTiming(name: QueueName, jobId: string): Promise<QueueTiming> {
  const queue = getQueue(name);
  const [counts, averageJobMs, bullJob] = await Promise.all([
    queue.getJobCounts('waiting', 'active', 'delayed', 'prioritized'), averageJobDuration(name), queue.getJob(jobId),
  ]);
  const state = bullJob ? await bullJob.getState() : 'unknown';
  const concurrency = concurrencyFor(name);
  const active = counts.active ?? 0;
  const waiting = counts.waiting ?? 0;
  const delayed = counts.delayed ?? 0;
  const prioritized = counts.prioritized ?? 0;
  const jobsAhead = state === 'completed' || state === 'failed' || state === 'active'
    ? 0 : Math.max(0, active + waiting + delayed + prioritized - 1);
  const position = state === 'completed' || state === 'failed' || state === 'active' ? 1 : jobsAhead + 1;
  const estimatedWaitMs = Math.ceil(jobsAhead / concurrency) * averageJobMs;
  const estimatedCompletionMs = estimatedWaitMs + averageJobMs;
  const now = Date.now();
  return {
    queue: name, state, concurrency, position, jobsAhead, averageJobMs,
    estimatedWaitMs, estimatedCompletionMs,
    estimatedStartAt: new Date(now + estimatedWaitMs).toISOString(),
    estimatedFinishAt: new Date(now + estimatedCompletionMs).toISOString(), approximate: true,
  };
}

export async function enqueueWithTiming(
  name: QueueName, payload: Record<string, unknown>, opts: EnqueueOptions = {},
): Promise<{ jobId: string; queue: QueueTiming }> {
  const jobId = await enqueue(name, payload, opts);
  return { jobId, queue: await queueTiming(name, jobId) };
}
