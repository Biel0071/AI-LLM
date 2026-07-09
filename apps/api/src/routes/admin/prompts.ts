import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

const promptCategories = ['produtos', 'marketing', 'imagem', 'video', 'seo', 'lojas', 'crm', 'whatsapp', 'catalogo', 'ocr'] as const;

export async function promptsRoutes(secured: FastifyInstance): Promise<void> {
  // Biblioteca de Prompts
  secured.get('/prompts', { schema: { tags: ['admin'] } }, async (req) => {
    const query = z.object({ tenantId: z.string().optional(), category: z.string().optional() }).parse(req.query ?? {});
    return { success: true, prompts: await prisma.prompt.findMany({
      where: { ...(query.tenantId ? { tenantId: query.tenantId } : {}), ...(query.category ? { category: query.category } : {}) },
      orderBy: [{ favorite: 'desc' }, { updatedAt: 'desc' }],
    }) };
  });
  secured.post('/prompts', { schema: { tags: ['admin'] } }, async (req) => {
    const body = z.object({ tenantId: z.string().optional(), name: z.string().trim().min(1).max(120), template: z.string().min(1).max(100_000), category: z.enum(promptCategories), favorite: z.boolean().default(false), shared: z.boolean().default(false) }).parse(req.body);
    const prompt = await prisma.prompt.create({ data: body });
    return { success: true, prompt };
  });
  secured.patch('/prompts/:id', { schema: { tags: ['admin'] } }, async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ name: z.string().trim().min(1).max(120).optional(), template: z.string().min(1).max(100_000).optional(), category: z.enum(promptCategories).optional(), favorite: z.boolean().optional(), shared: z.boolean().optional() }).parse(req.body);
    const prompt = await prisma.prompt.update({ where: { id }, data: { ...body, version: { increment: 1 } } });
    return { success: true, prompt };
  });
  secured.delete('/prompts/:id', { schema: { tags: ['admin'] } }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.prompt.delete({ where: { id } });
    return { success: true };
  });
}
