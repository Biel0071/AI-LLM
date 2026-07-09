import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { fail } from '@ai-platform/shared';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { overviewRoutes } from './overview';
import { providersRoutes } from './providers';
import { tenantsRoutes } from './tenants';
import { keysRoutes } from './keys';
import { workflowsRoutes } from './workflows';
import { promptsRoutes } from './prompts';
import { usersRoutes } from './users';
import { observabilityRoutes } from './observability';
import { imagesRoutes } from './images';

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // ---------- Login (publico) ----------
  app.post('/login', { schema: { tags: ['admin'] } }, async (req, reply) => {
    const body = z.object({
      login: z.string().trim().min(1).optional(),
      email: z.string().trim().optional(),
      password: z.string().min(1),
    }).refine((value) => value.login || value.email, { message: 'Informe email ou usuario' }).parse(req.body);
    const identifier = body.login ?? body.email ?? '';
    const email = identifier.toLowerCase() === 'admin' ? env.ADMIN_EMAIL : identifier;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.active || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send(fail('INVALID_CREDENTIALS', 'Email ou senha invalidos'));
    }
    const token = app.jwt.sign(
      { sub: user.id, email: user.email, role: user.role },
      { expiresIn: '12h' },
    );
    await prisma.auditLog.create({
      data: { userId: user.id, action: 'login', ip: req.ip },
    });
    return { success: true, token, user: { id: user.id, email: user.email, role: user.role } };
  });

  // ---------- Rotas protegidas (JWT admin), divididas por dominio ----------
  app.register(async (secured) => {
    secured.addHook('onRequest', app.requireAdmin);

    await secured.register(overviewRoutes);
    await secured.register(providersRoutes);
    await secured.register(tenantsRoutes);
    await secured.register(keysRoutes);
    await secured.register(workflowsRoutes);
    await secured.register(promptsRoutes);
    await secured.register(usersRoutes);
    await secured.register(observabilityRoutes);
    await secured.register(imagesRoutes);
  });
}
