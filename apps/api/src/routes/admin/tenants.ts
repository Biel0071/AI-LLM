import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

export async function tenantsRoutes(secured: FastifyInstance): Promise<void> {
  // Tenants
  secured.get('/tenants', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    tenants: await prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } }),
  }));

  secured.post('/tenants', { schema: { tags: ['admin'] } }, async (req) => {
    const body = z
      .object({
        name: z.string().min(1),
        slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
        defaultTextProvider: z.string().optional(),
        defaultImageProvider: z.string().optional(),
        rateLimitPerMinute: z.number().int().optional(),
      })
      .parse(req.body);
    const tenant = await prisma.tenant.create({ data: body });
    return { success: true, tenant };
  });

  // Projects
  secured.get('/projects', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    projects: await prisma.project.findMany({
      include: { tenant: { select: { id: true, name: true, slug: true } }, _count: { select: { apiKeys: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  }));

  secured.post('/projects', { schema: { tags: ['admin'] } }, async (req) => {
    const body = z.object({
      name: z.string().trim().min(1).max(100), tenantId: z.string().min(1),
      description: z.string().trim().max(500).optional(), domain: z.string().trim().max(255).optional(),
    }).parse(req.body);
    const project = await prisma.project.create({
      data: { ...body, description: body.description || null, domain: body.domain || null },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });
    await prisma.auditLog.create({ data: { userId: req.user.sub, action: 'project.created', target: project.id } });
    return { success: true, project };
  });
}
