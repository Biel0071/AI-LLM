import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { fail } from '@ai-platform/shared';
import { execute, registry, reloadRegistry } from '../../services/ai.service';
import { listProviderConfigs, saveProviderConfig } from '../../services/provider-config.service';
import { prisma } from '../../lib/prisma';

export async function providersRoutes(secured: FastifyInstance): Promise<void> {
  // Providers + health + modelos
  secured.get('/providers', { schema: { tags: ['admin'] } }, async () => {
    const providers = await Promise.all(
      registry.list().map(async (p) => {
        const health = await p.health();
        let models: unknown[] = [];
        try {
          models = await p.models();
        } catch {
          /* provider offline */
        }
        return { name: p.name, capabilities: p.capabilities, health, models };
      }),
    );
    return { success: true, defaults: registry.getDefaults(), providers };
  });

  secured.get('/provider-configs', { schema: { tags: ['admin'] } }, async () => ({
    success: true,
    configs: await listProviderConfigs(),
  }));

  secured.post('/provider-configs', { schema: { tags: ['admin'] } }, async (req) => {
    const body = z.object({
      name: z.enum(['ollama', 'groq', 'gemini', 'openrouter', 'huggingface', 'cloudflare', 'lmstudio', 'comfyui', 'forge', 'invokeai']),
      enabled: z.boolean().default(true),
      baseUrl: z.string().url().optional().or(z.literal('')),
      apiKey: z.string().optional(),
      accountId: z.string().optional(),
      defaultModel: z.string().optional(),
      embedModel: z.string().optional(),
    }).parse(req.body);
    await saveProviderConfig(body);
    const updated = await reloadRegistry();
    await prisma.auditLog.create({
      data: { userId: req.user.sub, action: 'provider.configured', target: body.name },
    });
    return { success: true, registered: updated.has(body.name) };
  });

  secured.post('/provider-configs/:name/test', { schema: { tags: ['admin'] } }, async (req, reply) => {
    const { name } = req.params as { name: string };
    await reloadRegistry();
    if (!registry.has(name)) return reply.code(400).send(fail('PROVIDER_NOT_CONFIGURED', 'Provider nao configurado ou desabilitado'));
    const health = await registry.get(name).health();
    return reply.code(health.ok ? 200 : 502).send({ success: health.ok, health });
  });

  secured.post('/test-text', { schema: { tags: ['admin'] } }, async (req) => {
    const body = z.object({
      prompt: z.string().min(1).max(20000),
      provider: z.string().optional(),
      model: z.string().optional(),
    }).parse(req.body);
    return execute('text', body, (provider) => provider.generateText(body), { cache: false });
  });
}
