import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isPrivateAddress, reverseSourceResponseSchema } from '@ai-platform/shared';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { enqueue, queueStats, type QueueName } from './queue.service';

const encryptionKey = createHash('sha256').update(env.JWT_SECRET).digest();
let pollTimer: NodeJS.Timeout | undefined;
let tickRunning = false;

function encryptSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64')).join('.');
}

function decryptSecret(value: string): string {
  const [iv, tag, encrypted] = value.split('.').map((part) => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function sealReverseSecret(secret: string): string {
  return encryptSecret(secret);
}


async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const target = new URL(rawUrl);
  if (target.protocol !== 'https:' && !(env.REVERSE_ALLOW_HTTP && target.protocol === 'http:')) {
    throw new Error('reverse connector URL must use HTTPS');
  }
  const addresses = await lookup(target.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('reverse connector URL resolves to a private or invalid address');
  }
  return target;
}

function validSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith('sha256=')) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
  const received = Buffer.from(signature.slice('sha256='.length));
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function releaseLock(key: string, token: string): Promise<void> {
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    1,
    key,
    token,
  ).catch(() => undefined);
}

export interface ReversePollResult {
  connectorId: string;
  requested: number;
  accepted: number;
  rejected: number;
  availableCapacity: number;
  cursor?: string;
  skipped?: 'locked' | 'no_capacity' | 'disabled';
}

export async function pollReverseConnector(connectorId: string, force = false): Promise<ReversePollResult> {
  const connector = await prisma.reverseConnector.findUnique({ where: { id: connectorId } });
  if (!connector) throw new Error('reverse connector not found');
  if (!connector.enabled && !force) {
    return { connectorId, requested: 0, accepted: 0, rejected: 0, availableCapacity: 0, skipped: 'disabled' };
  }

  const lockKey = `${env.QUEUE_PREFIX}:reverse-poll:${connector.id}`;
  const lockToken = randomUUID();
  const locked = await redis.set(lockKey, lockToken, 'PX', Math.max(env.REVERSE_TIMEOUT_MS * 2, 30_000), 'NX');
  if (locked !== 'OK') {
    return { connectorId, requested: 0, accepted: 0, rejected: 0, availableCapacity: 0, skipped: 'locked' };
  }

  const nextPollAt = new Date(Date.now() + connector.intervalSeconds * 1_000);
  try {
    const queues = await queueStats();
    const queued = queues.reduce((total, queue) => total + queue.queued, 0);
    const availableCapacity = Math.max(0, env.REVERSE_MAX_INFLIGHT - queued);
    if (!availableCapacity) {
      await prisma.reverseConnector.update({ where: { id: connector.id }, data: { nextPollAt } });
      return { connectorId, requested: 0, accepted: 0, rejected: 0, availableCapacity, skipped: 'no_capacity' };
    }

    const limit = Math.min(connector.batchSize, availableCapacity);
    const secret = decryptSecret(connector.secretEncrypted);
    const requestBody = JSON.stringify({
      event: 'population.requested',
      connectorId: connector.id,
      cursor: connector.cursor,
      limit,
      capacity: { available: availableCapacity, queues },
      timestamp: new Date().toISOString(),
    });
    const target = await assertSafeUrl(connector.sourceUrl);
    const signature = `sha256=${createHmac('sha256', secret).update(requestBody).digest('hex')}`;
    const started = Date.now();
    const response = await fetch(target, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'AI-Platform-Reverse-Poller/1.0',
        'x-ai-platform-event': 'population.requested',
        'x-ai-platform-signature': signature,
      },
      body: requestBody,
      signal: AbortSignal.timeout(env.REVERSE_TIMEOUT_MS),
    });
    const rawResponse = await response.text();
    if (!response.ok) throw new Error(`reverse source HTTP ${response.status}`);
    if (rawResponse.length > env.REVERSE_MAX_RESPONSE_BYTES) throw new Error('reverse source response is too large');
    if (env.REVERSE_REQUIRE_RESPONSE_SIGNATURE && !validSignature(rawResponse, response.headers.get('x-ai-platform-signature'), secret)) {
      throw new Error('reverse source response signature is invalid');
    }
    const parsed = reverseSourceResponseSchema.parse(JSON.parse(rawResponse));
    const jobs = parsed.jobs.slice(0, limit);
    let accepted = 0;
    let rejected = 0;
    for (const sourceJob of jobs) {
      try {
        await enqueue(sourceJob.type as QueueName, {
          ...sourceJob.payload,
          __reverse: { connectorId: connector.id, sourceJobId: sourceJob.sourceJobId, depth: 1 },
        }, {
          tenantId: connector.tenantId,
          projectId: connector.projectId ?? undefined,
          priority: sourceJob.priority,
          callback: { url: connector.resultUrl, secret },
        });
        accepted++;
      } catch (error) {
        rejected++;
        logger.warn({ connectorId: connector.id, sourceJobId: sourceJob.sourceJobId, error }, 'reverse job rejected');
      }
    }
    await prisma.reverseConnector.update({
      where: { id: connector.id },
      data: {
        cursor: parsed.cursor ?? connector.cursor,
        nextPollAt: parsed.hasMore && accepted > 0 ? new Date(Date.now() + 1_000) : nextPollAt,
        lastPollAt: new Date(),
        lastSuccessAt: new Date(),
        lastError: null,
        consecutiveFailures: 0,
        receivedJobs: { increment: accepted },
      },
    });
    logger.info({ connectorId: connector.id, accepted, rejected, ms: Date.now() - started }, 'reverse population poll completed');
    return { connectorId, requested: jobs.length, accepted, rejected, availableCapacity, cursor: parsed.cursor };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failureDelaySeconds = Math.min(3_600, connector.intervalSeconds * 2 ** Math.min(connector.consecutiveFailures, 6));
    const retryAt = new Date(Date.now() + failureDelaySeconds * 1_000);
    await prisma.reverseConnector.update({
      where: { id: connector.id },
      data: { nextPollAt: retryAt, lastPollAt: new Date(), lastError: message.slice(0, 2_000), consecutiveFailures: { increment: 1 } },
    }).catch(() => undefined);
    throw error;
  } finally {
    await releaseLock(lockKey, lockToken);
  }
}

async function pollDueConnectors(): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const due = await prisma.reverseConnector.findMany({
      where: { enabled: true, nextPollAt: { lte: new Date() } },
      orderBy: { nextPollAt: 'asc' },
      take: env.REVERSE_POLL_CONCURRENCY,
      select: { id: true },
    });
    await Promise.allSettled(due.map(({ id }) => pollReverseConnector(id)));
  } catch (error) {
    logger.error({ error }, 'reverse poller tick failed');
  } finally {
    tickRunning = false;
  }
}

export function startReversePoller(): void {
  if (!env.REVERSE_POLL_ENABLED || pollTimer) return;
  pollTimer = setInterval(() => void pollDueConnectors(), env.REVERSE_POLL_TICK_MS);
  pollTimer.unref();
  void pollDueConnectors();
  logger.info({ tickMs: env.REVERSE_POLL_TICK_MS, maxInflight: env.REVERSE_MAX_INFLIGHT }, 'reverse poller online');
}

export function stopReversePoller(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
}
