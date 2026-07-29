import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { FastifyInstance } from 'fastify';

export async function registerSwagger(app: FastifyInstance, docsEnabled = true): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'AI Platform',
        description:
          'AI Gateway centralizado. Toda comunicacao: Lovable -> AI Platform -> Provider -> Resposta.',
        version: '1.0.0',
      },
      servers: [{ url: '/' }],
      components: {
        securitySchemes: {
          apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' },
          bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      tags: [
        { name: 'v1', description: 'Endpoints publicos de IA (API key)' },
        { name: 'admin', description: 'Painel administrativo (JWT)' },
        { name: 'system', description: 'Health / metricas' },
      ],
    },
  });

  // O schema OpenAPI continua sendo gerado sempre (util internamente); o UI
  // publico em /docs so e montado quando habilitado (desligue em producao
  // exposta pra nao revelar a superficie da API sem necessidade).
  if (docsEnabled) {
    await app.register(swaggerUi, {
      routePrefix: '/docs',
    });
  }
}
