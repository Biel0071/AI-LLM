import { createHash } from 'crypto';
import { redis } from '../lib/redis';
import { ProviderResult } from '@repo/shared';

class SimpleLRU<K, V> {
  private cache = new Map<K, { value: V; expiresAt: number }>();
  constructor(private max: number) {}

  get(key: K): V | undefined {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }
    this.cache.delete(key);
    this.cache.set(key, item);
    return item.value;
  }

  set(key: K, value: V, ttlMs: number) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.max) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}

export interface CacheKeyParams {
  model: string;
  messages?: any[];
  prompt?: string;
  temperature?: number;
  top_p?: number;
  tools?: any[];
  system?: string;
  tenant: string;
}

export class CacheService {
  private l1Cache = new SimpleLRU<string, ProviderResult<any>>(500); // Max 500 items in L1

  /** L1 TTL em ms (30 segundos) */
  private L1_TTL = 30_000;
  
  /** L2 TTL em segundos (15 minutos) */
  private L2_TTL = 900;

  generateKey(params: CacheKeyParams): string {
    // Fingerprint semântico
    const normalizedMessages = (params.messages || []).map(m => {
      if (typeof m.content === 'string') {
        return {
          ...m,
          content: m.content.toLowerCase().trim().replace(/\\s+/g, ' ')
        };
      }
      return m;
    });

    const payload = JSON.stringify({
      model: params.model,
      messages: normalizedMessages,
      prompt: params.prompt ? params.prompt.toLowerCase().trim().replace(/\\s+/g, ' ') : undefined,
      temperature: params.temperature,
      top_p: params.top_p,
      tools: params.tools,
      system: params.system,
      tenant: params.tenant,
    });
    return createHash('sha256').update(payload).digest('hex');
  }

  async get(key: string): Promise<{ hit: 'L1' | 'L2' | 'MISS', data?: ProviderResult<any> }> {
    const l1 = this.l1Cache.get(key);
    if (l1) return { hit: 'L1', data: l1 };

    try {
      const l2 = await redis.get(`cache:${key}`);
      if (l2) {
        const parsed = JSON.parse(l2);
        // Repopulate L1
        this.l1Cache.set(key, parsed, this.L1_TTL);
        return { hit: 'L2', data: parsed };
      }
    } catch (err) {
      console.warn('[Cache L2] Error reading from redis', err);
    }

    return { hit: 'MISS' };
  }

  async set(key: string, data: ProviderResult<any>): Promise<void> {
    // Save to L1
    this.l1Cache.set(key, data, this.L1_TTL);
    
    // Save to L2
    try {
      await redis.set(`cache:${key}`, JSON.stringify(data), 'EX', this.L2_TTL);
    } catch (err) {
      console.warn('[Cache L2] Error writing to redis', err);
    }
  }
}

export const cacheService = new CacheService();
