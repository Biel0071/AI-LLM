import type { TokenUsage } from '@ai-platform/shared';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

export interface UsageRecord {
  tenantId?: string;
  capability: string;
  provider: string;
  model: string;
  cached: boolean;
  success: boolean;
  errorCode?: string;
  durationMs: number;
  tokens?: TokenUsage;
}

export class UsageService {
  private readonly pending: UsageRecord[] = [];
  private draining = false;
  private dropped = 0;
  private static readonly MAX_PENDING = 50_000;
  private static readonly WRITE_CONCURRENCY = 10;

  /** Custo estimado a partir da tabela ModelConfig (custo por 1k tokens). */
  private async estimateCost(provider: string, model: string, tokens?: TokenUsage): Promise<number> {
    if (!tokens?.prompt && !tokens?.completion) return 0;
    const config = await prisma.modelConfig.findFirst({
      where: { modelId: model, provider: { name: provider } },
    });
    if (!config) return 0;
    return (
      ((tokens.prompt ?? 0) / 1000) * config.costPer1kInput +
      ((tokens.completion ?? 0) / 1000) * config.costPer1kOutput
    );
  }

  /**
   * Grava auditoria fora do caminho HTTP, mas com concorrencia limitada.
   * Evita milhares de Promises/queries simultaneas em picos de populacao.
   */
  record(record: UsageRecord): void {
    if (this.pending.length >= UsageService.MAX_PENDING) {
      this.dropped++;
      if (this.dropped === 1 || this.dropped % 1_000 === 0) {
        logger.error({ dropped: this.dropped }, 'usage buffer full; records dropped');
      }
      return;
    }
    this.pending.push(record);
    if (!this.draining) void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const batch = this.pending.splice(0, UsageService.WRITE_CONCURRENCY);
        await Promise.all(batch.map((record) =>
          this.persist(record).catch((err) => logger.warn({ err }, 'usage record failed')),
        ));
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } finally {
      this.draining = false;
      if (this.pending.length > 0) void this.drain();
    }
  }

  private async persist(record: UsageRecord): Promise<void> {
    const cost = await this.estimateCost(record.provider, record.model, record.tokens);
    const totalTokens = record.tokens?.total ?? (record.tokens?.prompt ?? 0) + (record.tokens?.completion ?? 0);

    await prisma.requestLog.create({
      data: {
        tenantId: record.tenantId,
        capability: record.capability,
        provider: record.provider,
        model: record.model,
        cached: record.cached,
        success: record.success,
        errorCode: record.errorCode,
        durationMs: record.durationMs,
        promptTokens: record.tokens?.prompt ?? 0,
        completionTokens: record.tokens?.completion ?? 0,
        totalTokens,
        cost,
      },
    });

    if (record.tenantId) {
      const day = new Date();
      day.setUTCHours(0, 0, 0, 0);
      await prisma.usage.upsert({
        where: {
          tenantId_day_capability_provider: {
            tenantId: record.tenantId,
            day,
            capability: record.capability,
            provider: record.provider,
          },
        },
        create: {
          tenantId: record.tenantId,
          day,
          capability: record.capability,
          provider: record.provider,
          requests: 1,
          cachedHits: record.cached ? 1 : 0,
          totalTokens: BigInt(totalTokens),
          cost,
        },
        update: {
          requests: { increment: 1 },
          cachedHits: { increment: record.cached ? 1 : 0 },
          totalTokens: { increment: BigInt(totalTokens) },
          cost: { increment: cost },
        },
      });
    }
  }
}

export const usageService = new UsageService();
