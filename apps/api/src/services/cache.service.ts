import { cacheKey, StandardResponse, TokenUsage } from '@ai-platform/shared';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';

const PREFIX = 'aiplatform:cache:';

export interface CachedPayload {
  provider: string;
  model: string;
  tokens: TokenUsage | Record<string, never>;
  result: unknown;
  durationMs: number;
}

/**
 * Cache inteligente: mesmo prompt (+ provider + modelo + parametros)
 * nunca chama a IA novamente. Redis para leitura quente, Postgres para
 * persistencia/auditoria (prompt, hash, resposta, tempo, tokens).
 */
export class CacheService {
  private readonly pendingHits = new Map<string, number>();
  private hitTimer?: NodeJS.Timeout;
  private hitFlush?: Promise<void>;

  buildKey(capability: string, provider: string, model: string, input: unknown): string {
    return cacheKey(capability, provider, model, input);
  }

  async get(hash: string): Promise<CachedPayload | null> {
    if (!env.CACHE_ENABLED) return null;
    const raw = await redis.get(PREFIX + hash);
    if (raw) {
      this.registerHit(hash);
      return JSON.parse(raw) as CachedPayload;
    }
    // fallback: cache persistente (sobrevive a restart do Redis)
    const entry = await prisma.cacheEntry.findUnique({ where: { hash } });
    if (!entry) return null;
    const payload: CachedPayload = {
      provider: entry.provider,
      model: entry.model,
      tokens: { prompt: entry.promptTokens, completion: entry.completionTokens },
      result: entry.response as unknown,
      durationMs: entry.durationMs,
    };
    await redis.setex(PREFIX + hash, env.CACHE_TTL_SECONDS, JSON.stringify(payload));
    this.registerHit(hash);
    return payload;
  }

  async set(params: {
    hash: string;
    capability: string;
    prompt: string;
    response: StandardResponse;
  }): Promise<void> {
    if (!env.CACHE_ENABLED) return;
    const { hash, capability, prompt, response } = params;
    const payload: CachedPayload = {
      provider: response.provider,
      model: response.model,
      tokens: response.tokens,
      result: response.result,
      durationMs: response.executionTime,
    };
    try {
      await redis.setex(PREFIX + hash, env.CACHE_TTL_SECONDS, JSON.stringify(payload));
      const tokens = response.tokens as TokenUsage;
      await prisma.cacheEntry.upsert({
        where: { hash },
        create: {
          hash,
          capability,
          provider: response.provider,
          model: response.model,
          prompt: prompt.slice(0, 10_000),
          response: payload.result as object,
          promptTokens: tokens.prompt ?? 0,
          completionTokens: tokens.completion ?? 0,
          durationMs: response.executionTime,
        },
        update: { lastHitAt: new Date() },
      });
    } catch (err) {
      logger.warn({ err }, 'cache set failed');
    }
  }

  private registerHit(hash: string): void {
    this.pendingHits.set(hash, (this.pendingHits.get(hash) ?? 0) + 1);
    if (this.hitTimer) return;
    this.hitTimer = setTimeout(() => {
      this.hitTimer = undefined;
      void this.flushHits();
    }, 1_000);
    this.hitTimer.unref();
  }

  private async flushHits(): Promise<void> {
    if (this.hitFlush || this.pendingHits.size === 0) return this.hitFlush;
    const batch = Array.from(this.pendingHits.entries());
    this.pendingHits.clear();
    this.hitFlush = prisma.$transaction(batch.map(([hash, count]) =>
      prisma.cacheEntry.update({
        where: { hash },
        data: { hits: { increment: count }, lastHitAt: new Date() },
      }),
    )).then(() => undefined).catch((err) => {
      for (const [hash, count] of batch) this.pendingHits.set(hash, (this.pendingHits.get(hash) ?? 0) + count);
      logger.warn({ err }, 'cache hit flush failed');
    }).finally(() => {
      this.hitFlush = undefined;
      if (this.pendingHits.size > 0 && !this.hitTimer) {
        this.hitTimer = setTimeout(() => { this.hitTimer = undefined; void this.flushHits(); }, 1_000);
        this.hitTimer.unref();
      }
    });
    return this.hitFlush;
  }

  async stats(): Promise<{ entries: number; totalHits: number; redisKeys: number }> {
    const [entries, agg] = await Promise.all([
      prisma.cacheEntry.count(),
      prisma.cacheEntry.aggregate({ _sum: { hits: true } }),
    ]);
    let redisKeys = 0;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 500);
      cursor = next;
      redisKeys += keys.length;
    } while (cursor !== '0');
    return { entries, totalHits: agg._sum.hits ?? 0, redisKeys };
  }

  async clear(): Promise<number> {
    let cleared = 0;
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 500);
      cursor = next;
      if (keys.length) {
        await redis.del(...keys);
        cleared += keys.length;
      }
    } while (cursor !== '0');
    await prisma.cacheEntry.deleteMany({});
    return cleared;
  }
}

export const cacheService = new CacheService();
