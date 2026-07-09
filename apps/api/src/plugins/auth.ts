import jwt from '@fastify/jwt';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { hashApiKey } from '@ai-platform/shared';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';

export interface AuthContext {
  tenantId: string;
  apiKeyId: string;
  projectId?: string;
  scopes: string[];
}

declare module 'fastify' {
  interface FastifyRequest { auth?: AuthContext; }
  interface FastifyInstance {
    requireApiKey: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string; role: string };
    user: { sub: string; email: string; role: string };
  }
}

const API_KEY_CACHE_TTL = 60;

function extractApiKey(req: FastifyRequest): string | undefined {
  const headerKey = req.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey) return headerKey;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ap_')) return auth.slice('Bearer '.length);
  return undefined;
}

export async function registerAuth(app: FastifyInstance): Promise<void> {
  await app.register(jwt, { secret: env.JWT_SECRET });

  app.decorate('requireApiKey', async (req: FastifyRequest, reply: FastifyReply) => {
    const key = extractApiKey(req);
    if (!key) {
      reply.code(401).send({ success: false, error: { code: 'MISSING_API_KEY', message: 'Envie a chave em x-api-key ou Authorization: Bearer ap_...' } });
      return;
    }
    const keyHash = hashApiKey(key);
    const cacheId = `aiplatform:apikey:v2:${keyHash}`;
    let ctx: AuthContext | null = null;
    const cached = await redis.get(cacheId).catch(() => null);
    if (cached) {
      try { ctx = JSON.parse(cached) as AuthContext; } catch { ctx = null; }
    }
    if (!ctx) {
      const record = await prisma.apiKey.findUnique({ where: { keyHash } });
      if (record && record.active && (!record.expiresAt || record.expiresAt > new Date())) {
        ctx = {
          tenantId: record.tenantId,
          apiKeyId: record.id,
          projectId: record.projectId ?? undefined,
          scopes: record.scopes.split(',').map((scope) => scope.trim()).filter(Boolean),
        };
        await redis.setex(cacheId, API_KEY_CACHE_TTL, JSON.stringify(ctx)).catch(() => undefined);
        void prisma.apiKey.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
      }
    }
    if (!ctx) {
      reply.code(401).send({ success: false, error: { code: 'INVALID_API_KEY', message: 'API key invalida, expirada ou revogada' } });
      return;
    }
    req.auth = ctx;
  });

  app.decorate('requireAdmin', async (req: FastifyRequest, reply: FastifyReply) => {
    try { await req.jwtVerify(); }
    catch {
      reply.code(401).send({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token JWT invalido ou ausente' } });
      return;
    }
    if (req.user.role !== 'admin') {
      reply.code(403).send({ success: false, error: { code: 'FORBIDDEN', message: 'Requer perfil admin' } });
    }
  });
}