import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';

export async function usersRoutes(secured: FastifyInstance): Promise<void> {
  // Usuarios
  secured.get('/users', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    users: await prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  }));

  secured.post('/users', { schema: { tags: ['admin'] } }, async (req) => {
    const body = z
      .object({
        email: z.string().email(),
        name: z.string().optional(),
        password: z.string().min(6),
        role: z.enum(['admin', 'user']).default('user'),
      })
      .parse(req.body);
    const user = await prisma.user.create({
      data: {
        email: body.email,
        name: body.name,
        role: body.role,
        passwordHash: await bcrypt.hash(body.password, 10),
      },
      select: { id: true, email: true, role: true },
    });
    return { success: true, user };
  });
}
