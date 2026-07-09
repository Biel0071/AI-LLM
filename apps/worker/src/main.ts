import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDecipheriv, createHash } from 'node:crypto';
import { Worker } from 'bullmq';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import { createRegistryFromEnv } from '@ai-platform/shared';
import { processors } from './processors';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

const prisma = new PrismaClient();
let registry = createRegistryFromEnv(process.env);
const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);
const prefix = process.env.QUEUE_PREFIX ?? 'aiplatform';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

async function loadRegistryFromDatabase() {
  const merged: Record<string, string | undefined> = { ...process.env };
  const encryptionKey = createHash('sha256').update(process.env.JWT_SECRET ?? '').digest();
  const rows = await prisma.providerConfig.findMany({ where: { enabled: true } });
  for (const row of rows) {
    const s = (row.settings ?? {}) as any; const prefixName = row.name.toUpperCase();
    let secret: string | undefined;
    if (s.apiKeyEncrypted) {
      const [iv, tag, data] = String(s.apiKeyEncrypted).split('.');
      const decipher = createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      secret = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    }
    if (row.name === 'cloudflare') {
      merged.CLOUDFLARE_ACCOUNT_ID=s.accountId; merged.CLOUDFLARE_API_TOKEN=secret; merged.CLOUDFLARE_BASE_URL=s.baseUrl; merged.CLOUDFLARE_DEFAULT_MODEL=s.defaultModel;
    } else if (['ollama','lmstudio','comfyui','forge','invokeai'].includes(row.name)) {
      merged[`${prefixName}_BASE_URL`]=s.baseUrl; merged[`${prefixName}_DEFAULT_MODEL`]=s.defaultModel;
    } else {
      merged[`${prefixName}_API_KEY`]=secret; merged[`${prefixName}_BASE_URL`]=s.baseUrl; merged[`${prefixName}_DEFAULT_MODEL`]=s.defaultModel;
    }
  }
  return createRegistryFromEnv(merged);
}

const queueNames = Object.keys(processors);
const workers: Worker[] = [];

function connection() {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    maxRetriesPerRequest: null,
  };
}

async function markJob(
  jobId: string | undefined,
  data: Partial<{
    status: string;
    result: object;
    error: string | null;
    provider: string;
    model: string;
    durationMs: number;
    startedAt: Date;
    finishedAt: Date;
  }>,
): Promise<void> {
  if (!jobId) return;
  await prisma.job
    .update({ where: { id: jobId }, data: { ...data, attempts: { increment: data.startedAt ? 1 : 0 } } })
    .catch(() => undefined);
}

async function persistGeneratedImages(jobId: string | undefined, jobData: any, response: any): Promise<void> {
  const images = response?.result?.images;
  if (!Array.isArray(images) || !images.length) return;
  const dir = process.env.IMAGE_STORAGE_PATH ?? '/app/storage/images';
  await mkdir(dir, { recursive: true });
  for (const image of images) {
    if (!image?.base64) continue;
    const record = await prisma.image.create({ data: {
      tenantId: jobData.__tenantId, projectId: jobData.__projectId, jobId, provider: response.provider,
      model: response.model, prompt: jobData.prompt, kind: jobData.__kind ?? 'generation',
      base64Size: image.base64.length, seed: jobData.seed != null ? BigInt(jobData.seed) : undefined,
    }});
    await writeFile(path.join(dir, `${record.id}.png`), Buffer.from(image.base64, 'base64'));
    const url = `/v1/images/${record.id}/file`;
    await prisma.image.update({ where: { id: record.id }, data: { url } });
    delete image.base64; image.url = url;
  }
}

// A fila "image" processa fisicamente 1 workflow por vez no ComfyUI (GPU
// unica, fila serial do lado do servidor). Deixar o BullMQ despachar varios
// jobs de imagem "ativos" ao mesmo tempo (WORKER_CONCURRENCY generico) e
// falsa concorrencia: cada job tenta gerar ate "count" imagens em sequencia,
// e cada imagem individual tem seu proprio timeout de 300s dentro do loop -
// se 4 jobs disputam a mesma fila real do ComfyUI, imagens especificas
// esperam tanto que estouram esse timeout e derrubam o job INTEIRO, mesmo
// que outras imagens do mesmo job ja tivessem sido geradas com sucesso.
// Rodando a fila "image" com concorrencia 1 no BullMQ, os jobs processam
// um de cada vez de verdade - mais lento por job individual, mas sem
// timeouts em cascata, refletindo a capacidade real do hardware (1 GPU).
const imageConcurrency = Number(process.env.IMAGE_WORKER_CONCURRENCY) || 1;

for (const name of queueNames) {
  const worker = new Worker(
    name,
    async (job) => {
      const jobId = (job.data as any).__jobId as string | undefined;
      logger.info({ queue: name, jobId }, 'job started');
      await markJob(jobId, { status: 'active', startedAt: new Date() });
      const start = Date.now();
      try {
        registry = await loadRegistryFromDatabase();
        const result = await processors[name](job, registry);
        await persistGeneratedImages(jobId, job.data, result);
        await markJob(jobId, {
          status: 'completed',
          error: null,
          result: result as unknown as object,
          provider: result.provider,
          model: result.model,
          durationMs: Date.now() - start,
          finishedAt: new Date(),
        });
        logger.info({ queue: name, jobId, ms: Date.now() - start }, 'job completed');
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await markJob(jobId, {
          status: 'failed',
          error: message.slice(0, 2000),
          durationMs: Date.now() - start,
          finishedAt: new Date(),
        });
        logger.error({ queue: name, jobId, err: message }, 'job failed');
        throw err;
      }
    },
    { connection: connection(), prefix, concurrency: name === 'image' ? imageConcurrency : concurrency },
  );
  worker.on('error', (err) => logger.error({ queue: name, err: err.message }, 'worker error'));
  workers.push(worker);
}

// ---------- Heartbeat ----------
const hostname = os.hostname();
async function heartbeat(): Promise<void> {
  await prisma.workerNode
    .upsert({
      where: { hostname_queues: { hostname, queues: queueNames.join(',') } },
      create: { hostname, queues: queueNames.join(','), concurrency },
      update: { lastHeartbeat: new Date(), concurrency },
    })
    .catch((err) => logger.warn({ err }, 'heartbeat failed'));
}
let heartbeatRunning = false;
async function safeHeartbeat(): Promise<void> {
  if (heartbeatRunning) return;
  heartbeatRunning = true;
  try { await heartbeat(); } finally { heartbeatRunning = false; }
}
void safeHeartbeat();
const heartbeatTimer = setInterval(() => void safeHeartbeat(), 30_000);

logger.info(
  { queues: queueNames, concurrency, providers: registry.list().map((p) => p.name) },
  'AI Platform worker online',
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down workers');
  clearInterval(heartbeatTimer);
  await Promise.all(workers.map((w) => w.close()));
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
