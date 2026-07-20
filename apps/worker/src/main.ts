import os from 'node:os';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { createDecipheriv, createHash } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import pino from 'pino';
import { PrismaClient } from '@prisma/client';
import {
  createRegistryFromEnv,
  deterministicTextQuality,
  ProviderRegistry,
  QualityGateError,
  QualityReport,
  StandardResponse,
} from '@ai-platform/shared';
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
const maxConcurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 4));
let effectiveConcurrency = maxConcurrency;
const prefix = process.env.QUEUE_PREFIX ?? 'aiplatform';
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const registryTtlMs = Math.max(1_000, Number(process.env.PROVIDER_REGISTRY_TTL_MS ?? 15_000));
const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/aiplatform-worker-heartbeat';
const globalConcurrency = Math.max(1, Number(process.env.GLOBAL_WORKER_CONCURRENCY ?? maxConcurrency));
let registryLoadedAt = 0;

interface SchedulerWaiter { exclusive: boolean; resolve: (release: () => void) => void }

/**
 * Jobs de imagem sao exclusivos: aguardam textos em andamento terminarem e
 * impedem o Ollama de recarregar enquanto o ComfyUI usa RAM/CPU. Jobs leves
 * compartilham o limite global, que pode ser reduzido em runtime.
 */
class AdaptiveJobScheduler {
  private activeShared = 0;
  private exclusiveActive = false;
  private readonly waiting: SchedulerWaiter[] = [];

  constructor(private limit: number) {}

  setLimit(limit: number): void {
    this.limit = Math.max(1, limit);
    this.drain();
  }

  acquire(exclusive: boolean): Promise<() => void> {
    return new Promise((resolve) => {
      this.waiting.push({ exclusive, resolve });
      this.drain();
    });
  }

  private drain(): void {
    if (this.exclusiveActive) return;
    const exclusiveIndex = this.waiting.findIndex((waiter) => waiter.exclusive);
    if (exclusiveIndex >= 0) {
      if (this.activeShared > 0) return;
      const [waiter] = this.waiting.splice(exclusiveIndex, 1);
      this.exclusiveActive = true;
      waiter.resolve(this.releaseOnce(() => { this.exclusiveActive = false; this.drain(); }));
      return;
    }
    while (this.activeShared < this.limit) {
      const index = this.waiting.findIndex((waiter) => !waiter.exclusive);
      if (index < 0) return;
      const [waiter] = this.waiting.splice(index, 1);
      this.activeShared++;
      waiter.resolve(this.releaseOnce(() => { this.activeShared--; this.drain(); }));
    }
  }

  private releaseOnce(release: () => void): () => void {
    let released = false;
    return () => { if (!released) { released = true; release(); } };
  }
}

const jobScheduler = new AdaptiveJobScheduler(globalConcurrency);
let registryRefresh: Promise<typeof registry> | undefined;

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
    if (row.name === 'kimi') {
      merged.MOONSHOT_API_KEY=secret; merged.MOONSHOT_BASE_URL=s.baseUrl; merged.MOONSHOT_DEFAULT_MODEL=s.defaultModel;
    } else if (row.name === 'cloudflare') {
      merged.CLOUDFLARE_ACCOUNT_ID=s.accountId; merged.CLOUDFLARE_API_TOKEN=secret; merged.CLOUDFLARE_BASE_URL=s.baseUrl; merged.CLOUDFLARE_DEFAULT_MODEL=s.defaultModel;
    } else if (['ollama','lmstudio','comfyui','forge','invokeai'].includes(row.name)) {
      merged[`${prefixName}_BASE_URL`]=s.baseUrl; merged[`${prefixName}_DEFAULT_MODEL`]=s.defaultModel;
    } else {
      merged[`${prefixName}_API_KEY`]=secret; merged[`${prefixName}_BASE_URL`]=s.baseUrl; merged[`${prefixName}_DEFAULT_MODEL`]=s.defaultModel;
    }
  }
  return createRegistryFromEnv(merged);
}

async function getRegistry() {
  if (Date.now() - registryLoadedAt < registryTtlMs) return registry;
  if (!registryRefresh) {
    registryRefresh = loadRegistryFromDatabase()
      .then((next) => {
        registry = next;
        registryLoadedAt = Date.now();
        return next;
      })
      .finally(() => { registryRefresh = undefined; });
  }
  return registryRefresh;
}

const queueNames = Object.keys(processors);
const workers: Worker[] = [];
const workersByQueue = new Map<string, Worker>();

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

interface ReverseCallback {
  url: string;
  secret?: string;
}

const webhookQueue = new Queue('webhook', {
  connection: connection(),
  prefix,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: { age: 24 * 3600, count: 2_000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 5_000 },
  },
});

async function enqueueReverseCallback(
  jobId: string | undefined,
  callback: ReverseCallback | undefined,
  event: 'job.completed' | 'job.failed',
  body: Record<string, unknown>,
): Promise<void> {
  if (!jobId || !callback?.url) return;
  try {
    await webhookQueue.add('webhook', { ...callback, event, body }, {
      jobId: `${jobId}-${event.replace('.', '-')}`,
    });
  } catch (err) {
    logger.error({ jobId, event, err }, 'failed to enqueue reverse callback');
  }
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
    startedAt: Date | null;
    finishedAt: Date | null;
  }>,
): Promise<void> {
  if (!jobId) return;
  await prisma.job
    .update({ where: { id: jobId }, data: { ...data, attempts: { increment: data.startedAt ? 1 : 0 } } })
    .catch(() => undefined);
}

function clampQuality(value: unknown): number {
  const score = Number(value);
  return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
}

function parseJudgeReport(text: string, threshold: number): QualityReport | undefined {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return undefined;
  try {
    const parsed = JSON.parse(match[0]) as { score?: unknown; issues?: unknown };
    const score = clampQuality(parsed.score);
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.filter((item): item is string => typeof item === 'string').slice(0, 10)
      : [];
    return { score, threshold, passed: score >= threshold, method: 'kimi-judge', issues };
  } catch { return undefined; }
}

function resultAsText(result: unknown): string | undefined {
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return undefined;
  const value = result as Record<string, unknown>;
  if (typeof value.text === 'string') return value.text;
  if (value.message && typeof value.message === 'object' && typeof (value.message as Record<string, unknown>).content === 'string') {
    return (value.message as Record<string, unknown>).content as string;
  }
  if (!Array.isArray(value.images)) return JSON.stringify(value);
  return undefined;
}

async function assessJobQuality(
  queue: string,
  data: Record<string, any>,
  response: StandardResponse,
  activeRegistry: ProviderRegistry,
): Promise<QualityReport | undefined> {
  if (queue === 'webhook' || queue === 'embedding') return undefined;
  const threshold = clampQuality(data.minQuality ?? process.env.MIN_OUTPUT_QUALITY ?? 90);
  const text = resultAsText(response.result);
  const generatedImages = (response.result as { images?: Array<{ base64?: string; url?: string }> } | undefined)?.images;
  let report: QualityReport;

  if (Array.isArray(generatedImages)) {
    const valid = generatedImages.filter((image) => (image.base64?.length ?? 0) > 4_096 || Boolean(image.url));
    const score = generatedImages.length > 0 && valid.length === generatedImages.length ? 100 : 30;
    report = { score, threshold, passed: score >= threshold, method: 'deterministic', issues: score === 100 ? [] : ['missing_or_too_small_image'] };
  } else if (text !== undefined) {
    report = deterministicTextQuality(text, threshold, {
      jsonExpected: data.json === true || queue === 'seo',
      shortAnswer: data.json !== true && queue !== 'seo',
    });
  } else {
    report = { score: 0, threshold, passed: false, method: 'deterministic', issues: ['unsupported_or_empty_output'] };
  }

  const judgeName = process.env.QUALITY_JUDGE_PROVIDER ?? 'kimi';
  if (process.env.QUALITY_SEMANTIC_JUDGE === 'false' || !activeRegistry.has(judgeName)) return report;
  try {
    const judge = activeRegistry.get(judgeName);
    const rubric = [
      'Atue como auditor rigoroso. Avalie fidelidade ao pedido, correcao factual, completude, clareza e ausencia de placeholders.',
      'Retorne SOMENTE JSON: {"score":0-100,"issues":["problema objetivo"]}.',
      `Pedido original: ${String(data.prompt ?? data.product ?? data.text ?? '').slice(0, 8_000)}`,
    ].join('\n');
    let judgeText: string | undefined;
    if (Array.isArray(generatedImages) && generatedImages[0]?.base64 && judge.capabilities.includes('vision')) {
      const sourceImage = typeof data.image === 'string' && !/^https?:/i.test(data.image) && data.image.length > 4_096
        ? (data.image.startsWith('data:') ? data.image : `data:image/png;base64,${data.image}`)
        : undefined;
      const judged = await judge.vision({
        prompt: `${rubric}\n${sourceImage ? 'A primeira imagem e a referencia e a segunda e o resultado.' : 'A imagem enviada e o resultado.'} Penalize fortemente produto, cor, angulo ou texto divergentes.`,
        images: [...(sourceImage ? [sourceImage] : []), `data:image/png;base64,${generatedImages[0].base64}`],
        model: process.env.QUALITY_JUDGE_MODEL ?? process.env.MOONSHOT_VISION_MODEL ?? 'kimi-k2.6', maxTokens: 400,
      });
      judgeText = judged.result.text;
    } else if (text !== undefined && judge.capabilities.includes('text')) {
      const judged = await judge.generateText({ prompt: `${rubric}\nSaida candidata:\n${text.slice(0, 12_000)}`, model: process.env.QUALITY_JUDGE_MODEL ?? 'kimi-k2.6', maxTokens: 400, json: true });
      judgeText = judged.result.text;
    }
    const semantic = judgeText ? parseJudgeReport(judgeText, threshold) : undefined;
    if (semantic) {
      semantic.score = Math.min(report.score, semantic.score);
      semantic.passed = semantic.score >= threshold;
      semantic.issues = Array.from(new Set([...report.issues, ...semantic.issues]));
      return semantic;
    }
  } catch (error) {
    logger.warn({ queue, judge: judgeName, err: error instanceof Error ? error.message : String(error) }, 'semantic quality judge unavailable');
  }
  return report;
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
      const releaseSlot = await jobScheduler.acquire(name === 'image');
      logger.info({ queue: name, jobId }, 'job started');
      await markJob(jobId, { status: 'active', startedAt: new Date() });
      const start = Date.now();
      try {
        const activeRegistry = await getRegistry();
        const result = await processors[name](job, activeRegistry);
        const quality = await assessJobQuality(name, job.data as Record<string, any>, result, activeRegistry);
        if (quality) {
          result.quality = quality;
          const strict = (job.data as any).strictQuality !== false && process.env.QUALITY_GATE_STRICT !== 'false';
          if (strict && !quality.passed) throw new QualityGateError(quality);
        }
        await persistGeneratedImages(jobId, job.data, result);
        const durationMs = Date.now() - start;
        const finishedAt = new Date();
        await markJob(jobId, {
          status: 'completed',
          error: null,
          result: result as unknown as object,
          provider: result.provider,
          model: result.model,
          durationMs,
          finishedAt,
        });
        await enqueueReverseCallback(jobId, (job.data as any).__callback, 'job.completed', {
          event: 'job.completed', jobId, queue: name, status: 'completed', result,
          provider: result.provider, model: result.model, durationMs, finishedAt: finishedAt.toISOString(),
        });
        logger.info({ queue: name, jobId, ms: durationMs }, 'job completed');
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const maxAttempts = Number(job.opts.attempts ?? 1);
        // Entrada invalida e deterministica nao melhora com retry.
        const permanentFailure = /Invalid argument returned 22|invalid image|unsupported|validation|unauthori[sz]ed|forbidden|authentication|api[ -]?key|model.*not found|(?:http|status)\s*(?:400|401|403|404)/i.test(message);
        if (permanentFailure) job.discard();
        const willRetry = !permanentFailure && job.attemptsMade + 1 < maxAttempts;
        const durationMs = Date.now() - start;
        const finishedAt = willRetry ? null : new Date();
        await markJob(jobId, {
          status: willRetry ? 'waiting' : 'failed',
          error: message.slice(0, 2000),
          durationMs,
          startedAt: willRetry ? null : undefined,
          finishedAt,
        });
        if (!willRetry) {
          await enqueueReverseCallback(jobId, (job.data as any).__callback, 'job.failed', {
            event: 'job.failed', jobId, queue: name, status: 'failed', error: message.slice(0, 2000),
            durationMs, finishedAt: finishedAt?.toISOString(),
          });
        }
        logger[willRetry ? 'warn' : 'error'](
          { queue: name, jobId, attempt: job.attemptsMade + 1, maxAttempts, err: message },
          willRetry ? 'job failed; retry scheduled' : 'job failed permanently',
        );
        throw err;
      } finally {
        releaseSlot();
      }
    },
    {
      connection: connection(),
      prefix,
      concurrency: name === 'image' ? imageConcurrency : effectiveConcurrency,
      lockDuration: 120_000,
      stalledInterval: 30_000,
      maxStalledCount: 2,
      drainDelay: 5,
    },
  );
  worker.on('error', (err) => logger.error({ queue: name, err: err.message }, 'worker error'));
  worker.on('stalled', (jobId) => {
    logger.warn({ queue: name, jobId }, 'stalled job recovered by BullMQ');
    void markJob(String(jobId), { status: 'waiting', startedAt: null, finishedAt: null });
  });
  workers.push(worker);
  workersByQueue.set(name, worker);
}

// Ajusta apenas filas leves (texto/SEO/OCR/etc.) conforme a memoria livre.
// Imagem continua serial, respeitando a capacidade real de uma unica GPU.
function tuneConcurrency(): void {
  if (process.env.ADAPTIVE_CONCURRENCY === 'false') return;
  const processMemory = process as NodeJS.Process & {
    availableMemory?: () => number;
    constrainedMemory?: () => number;
  };
  const available = processMemory.availableMemory?.() ?? os.freemem();
  const constrained = processMemory.constrainedMemory?.();
  const total = constrained && constrained > 0 ? constrained : os.totalmem();
  const freeRatio = available / Math.max(1, total);
  const cpuRatio = os.loadavg()[0] / Math.max(1, os.availableParallelism());
  const memoryTarget = freeRatio < 0.12 ? 1 : freeRatio < 0.25 ? Math.max(1, Math.ceil(maxConcurrency / 2)) : maxConcurrency;
  const cpuTarget = cpuRatio > 1.1 ? 1 : cpuRatio > 0.8 ? Math.max(1, Math.ceil(maxConcurrency / 2)) : maxConcurrency;
  const target = Math.min(memoryTarget, cpuTarget);
  if (target === effectiveConcurrency) return;
  effectiveConcurrency = target;
  jobScheduler.setLimit(Math.min(globalConcurrency, target));
  for (const [name, worker] of workersByQueue) {
    if (name !== 'image') worker.concurrency = target;
  }
  logger.warn({
    freeRatio: Number(freeRatio.toFixed(3)), cpuRatio: Number(cpuRatio.toFixed(3)), concurrency: target,
  }, 'worker concurrency adjusted to available resources');
}
const resourceTimer = setInterval(tuneConcurrency, 15_000);
tuneConcurrency();

// ---------- Heartbeat ----------
const hostname = os.hostname();
async function heartbeat(): Promise<void> {
  await writeFile(heartbeatFile, String(Date.now()));
  await prisma.workerNode
    .upsert({
      where: { hostname_queues: { hostname, queues: queueNames.join(',') } },
      create: { hostname, queues: queueNames.join(','), concurrency: effectiveConcurrency },
      update: { lastHeartbeat: new Date(), concurrency: effectiveConcurrency },
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
  { queues: queueNames, concurrency: maxConcurrency, globalConcurrency, adaptive: process.env.ADAPTIVE_CONCURRENCY !== 'false', providers: registry.list().map((p) => p.name) },
  'AI Platform worker online',
);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down workers');
  clearInterval(heartbeatTimer);
  clearInterval(resourceTimer);
  await Promise.all(workers.map((w) => w.close()));
  await webhookQueue.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
