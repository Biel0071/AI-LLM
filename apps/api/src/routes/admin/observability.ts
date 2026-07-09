import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { cacheService } from '../../services/cache.service';
import { queueStats } from '../../services/queue.service';

export async function observabilityRoutes(secured: FastifyInstance): Promise<void> {
  // Logs
  secured.get('/logs', { schema: { tags: ['admin'] } }, async (req) => {
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(500).default(100),
        provider: z.string().optional(),
        capability: z.string().optional(),
      })
      .parse(req.query);
    const logs = await prisma.requestLog.findMany({
      where: { provider: query.provider, capability: query.capability },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { success: true, logs };
  });

  // Uso / custos (agregado por dia)
  secured.get('/usage', { schema: { tags: ['admin'] } }, async (req) => {
    const query = z.object({ days: z.coerce.number().int().min(1).max(90).default(30) }).parse(req.query);
    const since = new Date(Date.now() - query.days * 24 * 3600 * 1000);
    const usage = await prisma.usage.findMany({
      where: { day: { gte: since } },
      include: { tenant: { select: { name: true, slug: true } } },
      orderBy: { day: 'desc' },
    });
    return {
      success: true,
      usage: usage.map((u) => ({ ...u, totalTokens: u.totalTokens.toString() })),
    };
  });

  // Filas
  secured.get('/queues', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    queues: await queueStats(),
  }));

  // Jobs
  secured.get('/jobs', { schema: { tags: ['admin'] } }, async (req) => {
    const query = z
      .object({
        status: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    const jobs = await prisma.job.findMany({
      where: { status: query.status },
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    return { success: true, jobs };
  });

  // Workers
  secured.get('/workers', { schema: { tags: ['admin'] } }, async () => {
    const cutoff = new Date(Date.now() - 60_000);
    const workers = await prisma.workerNode.findMany({ orderBy: { lastHeartbeat: 'desc' } });
    return {
      success: true,
      workers: workers.map((w) => ({ ...w, online: w.lastHeartbeat > cutoff })),
    };
  });

  // Cache
  secured.get('/cache', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    stats: await cacheService.stats(),
  }));

  secured.delete('/cache', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    cleared: await cacheService.clear(),
  }));

  // Configuracao de modelos/custos
  secured.get('/models', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    providers: await prisma.providerConfig.findMany({ include: { models: true } }),
  }));

  secured.post('/models', { schema: { tags: ['admin'] } }, async (req) => {
    const body = z
      .object({
        provider: z.string().min(1),
        modelId: z.string().min(1),
        displayName: z.string().optional(),
        capability: z.string().default('text'),
        costPer1kInput: z.number().min(0).default(0),
        costPer1kOutput: z.number().min(0).default(0),
      })
      .parse(req.body);
    const providerConfig = await prisma.providerConfig.upsert({
      where: { name: body.provider },
      create: { name: body.provider },
      update: {},
    });
    const model = await prisma.modelConfig.upsert({
      where: { providerId_modelId: { providerId: providerConfig.id, modelId: body.modelId } },
      create: {
        providerId: providerConfig.id,
        modelId: body.modelId,
        displayName: body.displayName,
        capability: body.capability,
        costPer1kInput: body.costPer1kInput,
        costPer1kOutput: body.costPer1kOutput,
      },
      update: {
        displayName: body.displayName,
        costPer1kInput: body.costPer1kInput,
        costPer1kOutput: body.costPer1kOutput,
      },
    });
    return { success: true, model };
  });

  // Auditoria
  secured.get('/audit', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    logs: await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 }),
  }));
}
