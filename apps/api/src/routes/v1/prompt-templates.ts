import { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma';
import z from 'zod';

const createTemplateSchema = z.object({
  name: z.string(),
  slug: z.string(),
  systemPrompt: z.string(),
  variables: z.array(z.string()),
  active: z.boolean().optional().default(true),
});

const updateTemplateSchema = createTemplateSchema.partial();

export async function registerPromptTemplateRoutes(fastify: FastifyInstance) {
  fastify.addHook('onRequest', fastify.requireApiKey);

  fastify.get('/v1/prompt-templates', async (request, reply) => {
    const { tenantId } = request;
    const templates = await prisma.promptTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return { success: true, templates };
  });

  fastify.get('/v1/prompt-templates/:slug', async (request, reply) => {
    const { tenantId } = request;
    const { slug } = request.params as { slug: string };
    
    const template = await prisma.promptTemplate.findUnique({
      where: { slug },
    });

    if (!template || template.tenantId !== tenantId) {
      return reply.status(404).send({ success: false, error: 'Template not found' });
    }

    return { success: true, template };
  });

  fastify.post('/v1/prompt-templates', async (request, reply) => {
    const { tenantId } = request;
    const data = createTemplateSchema.parse(request.body);

    const template = await prisma.promptTemplate.create({
      data: {
        ...data,
        tenantId,
      },
    });

    return { success: true, template };
  });

  fastify.put('/v1/prompt-templates/:slug', async (request, reply) => {
    const { tenantId } = request;
    const { slug } = request.params as { slug: string };
    const data = updateTemplateSchema.parse(request.body);

    const existing = await prisma.promptTemplate.findUnique({ where: { slug } });
    if (!existing || existing.tenantId !== tenantId) {
      return reply.status(404).send({ success: false, error: 'Template not found' });
    }

    const template = await prisma.promptTemplate.update({
      where: { slug },
      data: {
        ...data,
        version: { increment: 1 },
      },
    });

    return { success: true, template };
  });

  fastify.delete('/v1/prompt-templates/:slug', async (request, reply) => {
    const { tenantId } = request;
    const { slug } = request.params as { slug: string };

    const existing = await prisma.promptTemplate.findUnique({ where: { slug } });
    if (!existing || existing.tenantId !== tenantId) {
      return reply.status(404).send({ success: false, error: 'Template not found' });
    }

    await prisma.promptTemplate.delete({ where: { slug } });
    return { success: true };
  });
}

