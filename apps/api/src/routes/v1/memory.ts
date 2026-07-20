import type { FastifyInstance } from 'fastify';
import { executionMemoryContext, executionMemoryHash } from '@ai-platform/shared';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

const feedbackSchema = z.object({
  jobId: z.string().min(1),
  accepted: z.boolean(),
});

function scopeKey(tenantId: string | undefined, projectId: string | undefined): string {
  return `${tenantId ?? 'global'}:${projectId ?? 'all'}`;
}

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/memory/stats', { schema: { tags: ['v1', 'memory'] } }, async (req) => {
    const scope = scopeKey(req.auth?.tenantId, req.auth?.projectId);
    const memories = await prisma.executionMemory.findMany({
      where: { scopeKey: scope },
      orderBy: [{ successCount: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });
    return {
      success: true,
      scope,
      memories: memories.map((memory) => ({
        ...memory,
        durationTotalMs: Number(memory.durationTotalMs),
        averageQuality: memory.successCount ? memory.qualityTotal / memory.successCount : 0,
        averageDurationMs: memory.successCount ? Number(memory.durationTotalMs) / memory.successCount : 0,
      })),
    };
  });

  app.post('/memory/feedback', { schema: { tags: ['v1', 'memory'] } }, async (req, reply) => {
    const body = feedbackSchema.parse(req.body);
    const job = await prisma.job.findFirst({
      where: {
        id: body.jobId,
        tenantId: req.auth!.tenantId,
        ...(req.auth?.projectId ? { projectId: req.auth.projectId } : {}),
        status: 'completed',
      },
      select: { id: true, queue: true, payload: true, provider: true, model: true, projectId: true },
    });
    if (!job?.provider || !job.model) {
      return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Job concluído não encontrado' } });
    }
    const payload = job.payload as Record<string, unknown>;
    const memory = await prisma.executionMemory.updateMany({
      where: {
        scopeKey: scopeKey(req.auth?.tenantId, job.projectId ?? undefined),
        queue: job.queue,
        contextHash: executionMemoryHash(job.queue, payload),
        provider: job.provider,
        model: job.model,
      },
      data: body.accepted ? { approvedCount: { increment: 1 } } : { rejectedCount: { increment: 1 } },
    });
    if (!memory.count) {
      return reply.code(409).send({ success: false, error: { code: 'MEMORY_NOT_READY', message: 'A memória deste job ainda não foi consolidada' } });
    }
    return {
      success: true,
      jobId: job.id,
      accepted: body.accepted,
      context: executionMemoryContext(job.queue, payload),
    };
  });
}
