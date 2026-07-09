import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { fail, hashApiKey } from '@ai-platform/shared';
import { prisma } from '../../lib/prisma';
import { redis } from '../../lib/redis';

export async function keysRoutes(secured: FastifyInstance): Promise<void> {
  // API Keys
  secured.get('/api-keys', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    keys: await prisma.apiKey.findMany({
      select: {
        id: true, name: true, prefix: true, active: true, lastUsedAt: true, expiresAt: true,
        scopes: true, environment: true, createdAt: true,
        tenant: { select: { id: true, name: true, slug: true } },
        project: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  }));

  secured.post('/api-keys', { schema: { tags: ['admin'] } }, async (req, reply) => {
    const body = z.object({
      name: z.string().min(1), tenantId: z.string().min(1), projectId: z.string().min(1).optional(),
      environment: z.enum(['live', 'test', 'dev']).default('live'),
      scopes: z.array(z.enum(['text', 'chat', 'image', 'video', 'vision', 'embed', 'ocr', 'workflow', 'admin'])).min(1).default(['text', 'chat']),
      expiresAt: z.string().datetime().optional(),
    }).parse(req.body);
    if (body.projectId) {
      const project = await prisma.project.findFirst({ where: { id: body.projectId, tenantId: body.tenantId } });
      if (!project) return reply.code(400).send(fail('INVALID_PROJECT', 'Projeto nao pertence ao tenant selecionado'));
    }
    const key = `ap_${body.environment}_${randomBytes(24).toString('hex')}`;
    const created = await prisma.apiKey.create({ data: {
      name: body.name, tenantId: body.tenantId, projectId: body.projectId,
      environment: body.environment, scopes: body.scopes.join(','),
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      keyHash: hashApiKey(key), prefix: key.slice(0, 14),
    } });
    return { success: true, id: created.id, key };
  });

  secured.delete('/api-keys/:id', { schema: { tags: ['admin'] } }, async (req) => {
    const { id } = req.params as { id: string };
    const revoked = await prisma.apiKey.update({ where: { id }, data: { active: false }, select: { keyHash: true } });
    await redis.del(`aiplatform:apikey:v2:${revoked.keyHash}`, `aiplatform:apikey:${revoked.keyHash}`);
    return { success: true };
  });
}
