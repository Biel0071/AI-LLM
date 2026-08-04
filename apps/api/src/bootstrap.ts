import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { hashApiKey } from '@api-platform/shared';
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

  // Provider config padrao para Ollama (Open-Source Local)
  const ollamaConfig = await prisma.providerConfig.findUnique({ where: { name: 'ollama' } });
  if (!ollamaConfig) {
    const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://api-platform-ollama-1:11434';
    await prisma.providerConfig.create({
      data: {
        name: 'ollama',
        enabled: true,
        baseUrl: ollamaUrl,
        settings: {
          baseUrl: ollamaUrl,
          defaultModel: process.env.OLLAMA_DEFAULT_MODEL || 'llama3:latest',
          embedModel: process.env.OLLAMA_EMBED_MODEL || 'nomic-embed-text',
        },
      },
    });
    logger.info('default ollama provider config created');
  }

  // Provider config padrao para Groq (Open-Source Gratis Cloud)
  const groqConfig = await prisma.providerConfig.findUnique({ where: { name: 'groq' } });
  if (!groqConfig) {
    await prisma.providerConfig.create({
      data: {
        name: 'groq',
        enabled: true,
        baseUrl: 'https://api.groq.com/openai/v1',
        settings: {
          baseUrl: 'https://api.groq.com/openai/v1',
          defaultModel: 'llama-3.3-70b-versatile',
        },
      },
    });
    logger.info('default groq provider config created');
  }
}

