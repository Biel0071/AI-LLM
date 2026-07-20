import type { FastifyInstance } from 'fastify';
import { reverseConnectorSchema } from '@ai-platform/shared';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { pollReverseConnector, sealReverseSecret } from '../../services/reverse-poller.service';

const paramsSchema = z.object({ id: z.string().min(1) });

function publicConnector<T extends Record<string, unknown>>(connector: T): Omit<T, 'secretEncrypted'> {
  const { secretEncrypted: _secret, ...safe } = connector;
  return safe;
}

export async function reverseRoutes(app: FastifyInstance): Promise<void> {
  app.get('/reverse/connectors', { schema: { tags: ['v1', 'reverse'] } }, async (req) => {
    const connectors = await prisma.reverseConnector.findMany({
      where: {
        tenantId: req.auth!.tenantId,
        ...(req.auth?.projectId ? { projectId: req.auth.projectId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, connectors: connectors.map(publicConnector) };
  });

  app.post('/reverse/connectors', { schema: { tags: ['v1', 'reverse'] } }, async (req, reply) => {
    const body = reverseConnectorSchema.parse(req.body);
    const projectId = req.auth?.projectId ?? body.projectId;
    const connector = await prisma.reverseConnector.create({
      data: {
        tenantId: req.auth!.tenantId,
        projectId,
        name: body.name,
        sourceUrl: body.sourceUrl,
        resultUrl: body.resultUrl,
        secretEncrypted: sealReverseSecret(body.secret),
        intervalSeconds: body.intervalSeconds,
        batchSize: body.batchSize,
        enabled: body.enabled,
        nextPollAt: new Date(),
      },
    });
    return reply.code(201).send({ success: true, connector: publicConnector(connector) });
  });

  app.patch('/reverse/connectors/:id', { schema: { tags: ['v1', 'reverse'] } }, async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const body = reverseConnectorSchema.partial().parse(req.body);
    const existing = await prisma.reverseConnector.findFirst({
      where: { id, tenantId: req.auth!.tenantId, ...(req.auth?.projectId ? { projectId: req.auth.projectId } : {}) },
    });
    if (!existing) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Conector não encontrado' } });
    const connector = await prisma.reverseConnector.update({
      where: { id },
      data: {
        name: body.name,
        sourceUrl: body.sourceUrl,
        resultUrl: body.resultUrl,
        secretEncrypted: body.secret ? sealReverseSecret(body.secret) : undefined,
        intervalSeconds: body.intervalSeconds,
        batchSize: body.batchSize,
        enabled: body.enabled,
        nextPollAt: body.enabled === true ? new Date() : undefined,
      },
    });
    return { success: true, connector: publicConnector(connector) };
  });

  app.delete('/reverse/connectors/:id', { schema: { tags: ['v1', 'reverse'] } }, async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const deleted = await prisma.reverseConnector.deleteMany({
      where: { id, tenantId: req.auth!.tenantId, ...(req.auth?.projectId ? { projectId: req.auth.projectId } : {}) },
    });
    if (!deleted.count) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Conector não encontrado' } });
    return reply.code(204).send();
  });

  app.post('/reverse/connectors/:id/poll', { schema: { tags: ['v1', 'reverse'] } }, async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const connector = await prisma.reverseConnector.findFirst({
      where: { id, tenantId: req.auth!.tenantId, ...(req.auth?.projectId ? { projectId: req.auth.projectId } : {}) },
      select: { id: true },
    });
    if (!connector) return reply.code(404).send({ success: false, error: { code: 'NOT_FOUND', message: 'Conector não encontrado' } });
    return { success: true, poll: await pollReverseConnector(id, true) };
  });
}
