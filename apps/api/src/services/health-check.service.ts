import { registry, providerCircuit, fallbackOrder } from './ai.service';
import { logger } from '../lib/logger';
import { Capability } from '@api-platform/shared';

const HEALTH_CHECK_INTERVAL_MS = 60 * 1000; // 1 minuto
let healthCheckTimer: NodeJS.Timeout | null = null;

export const providerHealthState = new Map<string, { status: 'healthy' | 'degraded' | 'offline', latency: number, lastCheck: number }>();

export function startHealthCheckWorker() {
  if (healthCheckTimer) return;
  
  logger.info('[HealthCheck] Iniciando worker assincrono de verificacao de providers');
  
  healthCheckTimer = setInterval(async () => {
    for (const providerName of fallbackOrder) {
      const start = Date.now();
      try {
        const provider = await registry.resolve('chat' as Capability, providerName);
        if (!provider) continue;

        let status: 'healthy' | 'degraded' | 'offline' = 'healthy';
        
        // Se o circuit breaker já diz que está off, marcamos offline
        if (providerCircuit.isOpen(providerName)) {
           status = 'offline';
        }

        const latency = Date.now() - start;
        providerHealthState.set(providerName, { status, latency, lastCheck: Date.now() });
        
        if (status === 'offline') {
           logger.warn(`[HealthCheck] Provider ${providerName} esta offline.`);
        }
      } catch (error) {
        providerCircuit.recordFailure(providerName);
        providerHealthState.set(providerName, { status: 'offline', latency: Date.now() - start, lastCheck: Date.now() });
        logger.error(`[HealthCheck] Falha na verificacao do provider ${providerName}`);
      }
    }
  }, HEALTH_CHECK_INTERVAL_MS);
}

export function stopHealthCheckWorker() {
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}
