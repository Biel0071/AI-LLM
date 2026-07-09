import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import { registry } from '../../services/ai.service';
import { cacheService } from '../../services/cache.service';
import { queueStats } from '../../services/queue.service';

export async function overviewRoutes(secured: FastifyInstance): Promise<void> {
  // Visao geral (home do dashboard)
  secured.get('/overview', { schema: { tags: ['admin'] } }, async () => {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [tenants, apiKeys, users, requests24h, cached24h, tokens, cost, queues, cache] =
      await Promise.all([
        prisma.tenant.count(),
        prisma.apiKey.count({ where: { active: true } }),
        prisma.user.count(),
        prisma.requestLog.count({ where: { createdAt: { gte: since } } }),
        prisma.requestLog.count({ where: { createdAt: { gte: since }, cached: true } }),
        prisma.requestLog.aggregate({
          where: { createdAt: { gte: since } },
          _sum: { totalTokens: true },
        }),
        prisma.requestLog.aggregate({
          where: { createdAt: { gte: since } },
          _sum: { cost: true },
        }),
        queueStats(),
        cacheService.stats(),
      ]);
    const avgDuration = await prisma.requestLog.aggregate({
      where: { createdAt: { gte: since }, cached: false },
      _avg: { durationMs: true },
    });
    return {
      success: true,
      overview: {
        tenants,
        apiKeys,
        users,
        last24h: {
          requests: requests24h,
          cachedHits: cached24h,
          totalTokens: tokens._sum.totalTokens ?? 0,
          cost: cost._sum.cost ?? 0,
          avgDurationMs: Math.round(avgDuration._avg.durationMs ?? 0),
        },
        queues,
        cache,
        providers: registry.list().map((p) => ({ name: p.name, capabilities: p.capabilities })),
      },
    };
  });
}
