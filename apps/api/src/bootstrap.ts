import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { hashApiKey } from '@ai-platform/shared';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';

/**
 * Bootstrap idempotente: garante usuario admin, tenant padrao e uma
 * API key inicial para conectar o Lovable em menos de 5 minutos.
 */
export async function bootstrap(): Promise<void> {
  // Admin
  const admin = await prisma.user.findUnique({ where: { email: env.ADMIN_EMAIL } });
  if (!admin) {
    await prisma.user.create({
      data: {
        email: env.ADMIN_EMAIL,
        name: 'Administrator',
        role: 'admin',
        passwordHash: await bcrypt.hash(env.ADMIN_PASSWORD, 10),
      },
    });
    logger.info({ email: env.ADMIN_EMAIL }, 'admin user created');
  }

  // Tenant padrao
  let tenant = await prisma.tenant.findUnique({ where: { slug: 'default' } });
  if (!tenant) {
    tenant = await prisma.tenant.create({ data: { name: 'Default', slug: 'default' } });
    logger.info('default tenant created');
  }

  // API key padrao
  const existingKeys = await prisma.apiKey.count({ where: { tenantId: tenant.id } });
  if (existingKeys === 0) {
    const key = env.DEFAULT_API_KEY || `ap_${randomBytes(24).toString('hex')}`;
    await prisma.apiKey.create({
      data: {
        tenantId: tenant.id,
        name: 'default',
        keyHash: hashApiKey(key),
        prefix: key.slice(0, 10),
      },
    });
    logger.warn(
      `API key padrao criada: ${key} — use no header x-api-key. ` +
        'Ela nao sera exibida novamente; gere novas chaves pelo dashboard.',
    );
  }
}
