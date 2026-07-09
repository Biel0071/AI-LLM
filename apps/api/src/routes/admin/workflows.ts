import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { registry, reloadRegistry } from '../../services/ai.service';
import { saveProviderConfig } from '../../services/provider-config.service';
import { prisma } from '../../lib/prisma';

export async function workflowsRoutes(secured: FastifyInstance): Promise<void> {
  // ComfyUI setup and workflow manager
  secured.get('/comfyui/setup', { schema: { tags: ['admin'] } }, async () => {
    await reloadRegistry();
    const provider = registry.has('comfyui') ? registry.get('comfyui') : null;
    const health = provider ? await provider.health() : { ok: false, message: 'ComfyUI nao configurado' };
    const models = provider && health.ok ? await provider.models() : [];
    const workflows = await prisma.imageWorkflow.findMany({ orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] });
    return { success: true, health, models, workflows };
  });

  secured.post('/comfyui/setup', { schema: { tags: ['admin'] } }, async (req) => {
    const body = z.object({ baseUrl: z.string().url(), defaultModel: z.string().optional() }).parse(req.body);
    await saveProviderConfig({ name: 'comfyui', enabled: true, ...body });
    await reloadRegistry();
    const provider = registry.get('comfyui');
    const health = await provider.health();
    const models = health.ok ? await provider.models() : [];
    return { success: health.ok, health, models };
  });

  secured.get('/workflows', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    workflows: await prisma.imageWorkflow.findMany({ orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }] }),
  }));

  secured.post('/workflows/import', { schema: { tags: ['admin'] } }, async (req) => {
    const body = z.object({ name: z.string().trim().min(1), graph: z.record(z.any()) }).parse(req.body);
    const count = await prisma.imageWorkflow.count({ where: { provider: 'comfyui' } });
    const workflow = await prisma.imageWorkflow.create({ data: { ...body, isDefault: count === 0 } });
    return { success: true, workflow };
  });

  secured.patch('/workflows/:id', { schema: { tags: ['admin'] } }, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().trim().min(1).optional(), enabled: z.boolean().optional(), isDefault: z.boolean().optional() }).parse(req.body);
    if (body.isDefault) await prisma.imageWorkflow.updateMany({ where: { provider: 'comfyui' }, data: { isDefault: false } });
    const workflow = await prisma.imageWorkflow.update({ where: { id }, data: body });
    return { success: true, workflow };
  });

  secured.post('/workflows/:id/duplicate', { schema: { tags: ['admin'] } }, async (req) => {
    const { id } = req.params as { id: string };
    const source = await prisma.imageWorkflow.findUniqueOrThrow({ where: { id } });
    const workflow = await prisma.imageWorkflow.create({ data: {
      name: `${source.name} - copia ${Date.now().toString().slice(-5)}`, provider: source.provider,
      graph: JSON.parse(JSON.stringify(source.graph)),
    } });
    return { success: true, workflow };
  });

  secured.get('/workflows/:id/export', { schema: { tags: ['admin'] } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const workflow = await prisma.imageWorkflow.findUniqueOrThrow({ where: { id } });
    reply.header('content-disposition', `attachment; filename="${workflow.name.replace(/[^a-z0-9_-]/gi, '_')}.json"`);
    return workflow.graph;
  });
}
