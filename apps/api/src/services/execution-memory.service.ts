import {
  chooseExecutionMemory,
  executionMemoryContext,
  executionMemoryHash,
  type ExecutionMemoryChoice,
} from '@ai-platform/shared';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

function scopeKey(tenantId?: string, projectId?: string): string {
  return `${tenantId ?? 'global'}:${projectId ?? 'all'}`;
}

export async function recallExecutionRoute(
  queue: string,
  data: Record<string, unknown>,
  tenantId?: string,
  projectId?: string,
): Promise<ExecutionMemoryChoice | undefined> {
  try {
    const candidates = await prisma.executionMemory.findMany({
      where: { scopeKey: scopeKey(tenantId, projectId), queue, contextHash: executionMemoryHash(queue, data) },
      select: {
        provider: true, model: true, successCount: true, failureCount: true,
        approvedCount: true, rejectedCount: true, qualityTotal: true, durationTotalMs: true,
      },
    });
    return chooseExecutionMemory(candidates);
  } catch (error) {
    logger.warn({ queue, error }, 'synchronous execution memory lookup failed');
    return undefined;
  }
}

export async function rememberExecutionSuccess(
  queue: string,
  data: Record<string, unknown>,
  route: { provider: string; model: string },
  quality: number,
  durationMs: number,
  tenantId?: string,
  projectId?: string,
): Promise<void> {
  const scope = scopeKey(tenantId, projectId);
  const contextHash = executionMemoryHash(queue, data);
  await prisma.executionMemory.upsert({
    where: { scopeKey_queue_contextHash_provider_model: { scopeKey: scope, queue, contextHash, provider: route.provider, model: route.model } },
    create: {
      scopeKey: scope, tenantId, projectId, queue, contextHash,
      context: executionMemoryContext(queue, data) as object,
      provider: route.provider, model: route.model, successCount: 1,
      qualityTotal: quality, durationTotalMs: BigInt(durationMs), lastUsedAt: new Date(),
    },
    update: {
      successCount: { increment: 1 }, qualityTotal: { increment: quality },
      durationTotalMs: { increment: BigInt(durationMs) }, lastUsedAt: new Date(),
    },
  }).catch((error) => logger.warn({ queue, error }, 'synchronous execution memory learning failed'));
}
