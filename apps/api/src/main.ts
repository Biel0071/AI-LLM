import { buildApp } from './app';
import { bootstrap } from './bootstrap';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { reloadRegistry } from './services/ai.service';
import { closeQueues } from './services/queue.service';

async function main(): Promise<void> {
  await bootstrap();
  await reloadRegistry();
  const app = await buildApp();

  const close = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await app.close();
    await closeQueues();
    await prisma.$disconnect();
    redis.disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info(`AI Platform API rodando em http://${env.HOST}:${env.PORT} (docs em /docs)`);
}

main().catch((err) => {
  logger.error(err, 'fatal error on startup');
  process.exit(1);
});
