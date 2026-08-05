import { prisma } from '../lib/prisma';
import { ProviderRegistry, RealMetrics } from '@api-platform/shared';

/**
 * Configura o fetcher de métricas reais do RequestLog para o ProviderRegistry.
 * Deve ser chamado durante a inicialização da API.
 */
export function setupMetricsFetcher(): void {
  ProviderRegistry.setMetricsFetcher(async (providerName: string): Promise<RealMetrics | null> => {
    const since = new Date(Date.now() - 24 * 3600 * 1000); // últimas 24h
    
    try {
      const [logs, errorLogs, totalLogs] = await Promise.all([
        prisma.requestLog.findMany({
          where: {
            provider: providerName,
            createdAt: { gte: since },
            success: true,
          },
          select: {
            durationMs: true,
            totalTokens: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        prisma.requestLog.count({
          where: {
            provider: providerName,
            createdAt: { gte: since },
            success: false,
          },
        }),
        prisma.requestLog.count({
          where: {
            provider: providerName,
            createdAt: { gte: since },
          },
        }),
      ]);
      
      if (logs.length === 0) {
        return null;
      }
      
      const avgDuration = logs.reduce((sum: number, log: { durationMs: number }) => sum + log.durationMs, 0) / logs.length;
      const totalTokens = logs.reduce((sum: number, log: { totalTokens: number }) => sum + (log.totalTokens || 0), 0);
      const totalTimeSeconds = logs.reduce((sum: number, log: { durationMs: number }) => sum + (log.durationMs / 1000), 0);
      const throughput = totalTimeSeconds > 0 ? totalTokens / totalTimeSeconds : 0;
      const errorRate = totalLogs > 0 ? errorLogs / totalLogs : 0;
      const health = Math.max(0, 1 - errorRate);
      
      return {
        health: Math.round(health * 1000) / 1000,
        latency: Math.round(avgDuration),
        throughput: Math.round(throughput),
        errorRate: Math.round(errorRate * 1000) / 1000,
        callCount: totalLogs,
      };
    } catch (error) {
      console.error(`[MetricsFetcher] Error fetching metrics for ${providerName}:`, error);
      return null;
    }
  });
}
