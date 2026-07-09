import {
  AIProvider,
  Capability,
  createRegistryFromEnv,
  ok,
  pickModel,
  ProviderRegistry,
  ProviderError,
  ProviderResult,
  StandardResponse,
  TaskHint,
} from '@ai-platform/shared';
import { cacheService } from './cache.service';
import { usageService } from './usage.service';
import { metrics } from '../metrics';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { buildProviderEnv } from './provider-config.service';

export let registry: ProviderRegistry = createRegistryFromEnv(process.env);

export async function reloadRegistry(): Promise<ProviderRegistry> {
  registry = createRegistryFromEnv(await buildProviderEnv());
  return registry;
}

export interface ExecuteContext {
  tenantId?: string;
  projectId?: string;
  cache?: boolean;
}

const fallbackOrder = (process.env.FREE_PROVIDER_ORDER ??
  'ollama,groq,gemini,cloudflare,openrouter,lmstudio')
  .split(',')
  .map((name) => name.trim())
  .filter(Boolean);

/** Pipeline central: cache por provider -> chamada -> fallback -> uso. */
export async function execute<T>(
  capability: Capability,
  request: { provider?: string; model?: string; fallback?: boolean; [key: string]: unknown },
  call: (provider: AIProvider) => Promise<ProviderResult<T>>,
  ctx: ExecuteContext = {},
): Promise<StandardResponse<T>> {
  const clientModel = request.model;
  let effectiveRequest = request;
  if (ctx.tenantId) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: ctx.tenantId },
      select: {
        active: true,
        defaultTextProvider: true,
        defaultImageProvider: true,
        defaultModel: true,
        monthlyTokenLimit: true,
        monthlyRequestLimit: true,
      },
    });
    if (!tenant?.active) {
      throw new ProviderError('gateway', 'tenant inactive', 'TENANT_INACTIVE', 403);
    }
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    if (tenant.monthlyRequestLimit || tenant.monthlyTokenLimit) {
      const aggregate = await prisma.requestLog.aggregate({
        where: { tenantId: ctx.tenantId, createdAt: { gte: monthStart }, success: true },
        _count: { _all: true },
        _sum: { totalTokens: true },
      });
      if (tenant.monthlyRequestLimit && aggregate._count._all >= tenant.monthlyRequestLimit) {
        throw new ProviderError('gateway', 'monthly request limit reached', 'MONTHLY_REQUEST_LIMIT', 429);
      }
      if (tenant.monthlyTokenLimit && BigInt(aggregate._sum.totalTokens ?? 0) >= tenant.monthlyTokenLimit) {
        throw new ProviderError('gateway', 'monthly token limit reached', 'MONTHLY_TOKEN_LIMIT', 429);
      }
    }
    const tenantProvider = capability === 'image' || capability === 'upscale'
      ? tenant.defaultImageProvider
      : capability === 'text' || capability === 'chat'
        ? tenant.defaultTextProvider
        : undefined;
    effectiveRequest = {
      ...request,
      provider: request.provider ?? tenantProvider ?? undefined,
      model: request.model ?? tenant.defaultModel ?? undefined,
    };
  }

  // Roteamento automatico de modelo: so preenche quando o chamador (ou o
  // default do tenant, acima) nao forcou um `model` explicito.
  if (!effectiveRequest.model) {
    let primaryProviderName: string | undefined;
    try {
      primaryProviderName = registry.resolve(capability, effectiveRequest.provider as string | undefined).name;
    } catch {
      primaryProviderName = effectiveRequest.provider as string | undefined;
    }
    const routedModel = primaryProviderName
      ? pickModel(capability, effectiveRequest.task as TaskHint | undefined, primaryProviderName, process.env)
      : undefined;
    if (routedModel) effectiveRequest = { ...effectiveRequest, model: routedModel };
  }

  Object.assign(request, effectiveRequest);

  const candidates = effectiveRequest.fallback === false
    ? [registry.resolve(capability, effectiveRequest.provider)]
    : registry.resolveCandidates(capability, effectiveRequest.provider, fallbackOrder);
  const useCache = ctx.cache !== false && effectiveRequest.cache !== false;
  const { provider: _provider, cache: _cache, wait: _wait, fallback: _fallback, ...cacheInput } = effectiveRequest;
  let lastError: unknown;

  for (const [candidateIndex, provider] of candidates.entries()) {
    request.model = candidateIndex === 0 ? effectiveRequest.model : clientModel;
    const requestedModel = request.model ?? 'provider-default';
    const modelKey = `${requestedModel}:${process.env.MODEL_CONFIG_VERSION ?? '1'}`;
    const hash = cacheService.buildKey(capability, provider.name, modelKey, cacheInput);

    if (useCache) {
      const cached = await cacheService.get(hash);
      if (cached) {
        metrics.requests.inc({ capability, provider: cached.provider, cached: 'true', status: 'ok' });
        usageService.record({
          tenantId: ctx.tenantId,
          capability,
          provider: cached.provider,
          model: cached.model,
          cached: true,
          success: true,
          durationMs: 0,
          tokens: cached.tokens,
        });
        return ok({
          provider: cached.provider,
          model: cached.model,
          executionTime: 0,
          tokens: cached.tokens,
          cached: true,
          result: cached.result as T,
        });
      }
    }

    const start = Date.now();
    try {
      const res = await call(provider);
      const durationMs = Date.now() - start;
      const response = ok({
        provider: provider.name,
        model: res.model,
        executionTime: durationMs,
        tokens: res.tokens,
        cached: false,
        result: res.result,
      });

      metrics.requests.inc({ capability, provider: provider.name, cached: 'false', status: 'ok' });
      metrics.duration.observe({ capability, provider: provider.name }, durationMs / 1000);
      if (res.tokens?.total) metrics.tokens.inc({ provider: provider.name }, res.tokens.total);
      usageService.record({
        tenantId: ctx.tenantId,
        capability,
        provider: provider.name,
        model: res.model,
        cached: false,
        success: true,
        durationMs,
        tokens: res.tokens,
      });

      if (useCache) {
        const promptText = typeof request.prompt === 'string'
          ? request.prompt
          : JSON.stringify(request.messages ?? request.input ?? '').slice(0, 10_000);
        void cacheService.set({ hash, capability, prompt: promptText, response });
      }
      return response;
    } catch (err) {
      lastError = err;
      const durationMs = Date.now() - start;
      metrics.requests.inc({ capability, provider: provider.name, cached: 'false', status: 'error' });
      usageService.record({
        tenantId: ctx.tenantId,
        capability,
        provider: provider.name,
        model: requestedModel,
        cached: false,
        success: false,
        errorCode: err instanceof Error ? err.name : 'UNKNOWN',
        durationMs,
      });
      logger.warn({ capability, provider: provider.name, err }, 'provider failed; trying fallback');
    }
  }

  throw lastError ?? new Error(`No provider available for ${capability}`);
}