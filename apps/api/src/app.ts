import Fastify, { FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { ZodError } from 'zod';
import { fail, ProviderError } from '@ai-platform/shared';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { registerAuth } from './plugins/auth';
import { registerSecurity } from './plugins/security';
import { registerSwagger } from './plugins/swagger';
import { registryProm } from './metrics';
import { registry } from './services/ai.service';
import { v1Routes } from './routes/v1';
import { adminRoutes } from './routes/admin';

export async function buildApp(): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    loggerInstance: logger as any,
    bodyLimit: env.MAX_UPLOAD_BYTES,
    requestTimeout: env.REQUEST_TIMEOUT_MS,
    // Socket fica ocioso (zero bytes) enquanto o provider gera a resposta (Ollama em
    // CPU pode levar 30-50s+). connectionTimeout precisa ser >= requestTimeout, senao
    // o Node mata o socket por inatividade antes do provider terminar (conexao cai
    // com "empty reply" mesmo dentro do requestTimeout configurado).
    connectionTimeout: env.REQUEST_TIMEOUT_MS,
    keepAliveTimeout: 72_000,
  }) as FastifyInstance;

  await registerSecurity(app);
  await registerAuth(app);
  await registerSwagger(app);

  // ---------- Tratamento de erros padrao ----------
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send(fail('VALIDATION_ERROR', 'Payload invalido', err.flatten()));
    }
    if (err instanceof ProviderError) {
      return reply.code(err.statusCode).send(fail(err.code, err.message));
    }
    const statusCode = Number((err as { statusCode?: number }).statusCode ?? 500);
    if (statusCode === 429) {
      return reply.code(429).send(fail('RATE_LIMITED', 'Limite de requisicoes excedido'));
    }
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send(fail('REQUEST_ERROR', statusCode === 413 ? 'Payload excede o limite permitido' : err instanceof Error ? err.message : 'Requisicao invalida'));
    }
    app.log.error(err);
    return reply.code(500).send(fail('INTERNAL_ERROR', 'Erro interno'));
  });

  // ---------- Health (publico) ----------
  app.get('/v1/health', { schema: { tags: ['system'] } }, async () => {
    const checks: Record<string, boolean> = {};
    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = true;
    } catch {
      checks.database = false;
    }
    try {
      checks.redis = (await redis.ping()) === 'PONG';
    } catch {
      checks.redis = false;
    }
    const healthy = Object.values(checks).every(Boolean);
    return {
      success: healthy,
      status: healthy ? 'ok' : 'degraded',
      checks,
      providers: registry.list().map((p) => p.name),
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  });

  // ---------- Metricas Prometheus ----------
  if (env.METRICS_ENABLED) {
    app.get('/metrics', { schema: { tags: ['system'] } }, async (_req, reply) => {
      reply.header('content-type', registryProm.contentType);
      return registryProm.metrics();
    });
  }

  // ---------- Rotas ----------
  await app.register(v1Routes, { prefix: '/v1' });
  await app.register(adminRoutes, { prefix: '/admin' });

  // ---------- Dashboard estatico ----------
  const dashboardDir = path.resolve(__dirname, '../../dashboard/public');
  await app.register(fastifyStatic, {
    root: dashboardDir,
    prefix: '/dashboard/',
    decorateReply: true,
  });
  app.get('/', async (_req, reply) => reply.redirect('/dashboard/'));

  return app;
}
