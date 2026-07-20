import { z } from 'zod';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import {
  chatSchema,
  ComfyUIProvider,
  embedSchema,
  fail,
  imageSchema,
  imageToImageSchema,
  imageGallerySchema,
  multiAngleSchema,
  videoToImageSchema,
  removeBackgroundSchema,
  inpaintSchema,
  outpaintSchema,
  controlnetSchema,
  ImageProvider,
  jobSchema,
  ocrSchema,
  ProviderError,
  textSchema,
  upscaleSchema,
  visionSchema,
} from '@ai-platform/shared';
import { execute, registry } from '../../services/ai.service';
import { enqueue, enqueueAndWait, enqueueWithTiming, QueueName, queueStats, queueTiming } from '../../services/queue.service';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { persistImageResponse } from '../../services/image-storage.service';
import { populationSummary, queueEntryPopulation, queuePopulationSummary } from '../../services/population.service';
import { reverseRoutes } from './reverse';
import { memoryRoutes } from './memory';

function resolveJobQueue(type: string, payload: Record<string, unknown>): QueueName {
  if (type === 'text' && payload.task === 'vision') {
    if (!Array.isArray(payload.images) || payload.images.length === 0) {
      throw new ProviderError('gateway', 'task vision requires payload.images; send type "vision" or POST /v1/vision', 'VISION_INPUT_REQUIRED', 400);
    }
    return 'vision';
  }
  return type as QueueName;
}
let activeSynchronousText = 0;
function acquireSynchronousTextSlot(): (() => void) | undefined {
  if (activeSynchronousText >= env.SYNC_TEXT_CONCURRENCY) return undefined;
  activeSynchronousText++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeSynchronousText--;
  };
}
export async function v1Routes(app: FastifyInstance): Promise<void> {
  // Todas as rotas /v1 exigem API key + rate limit por chave
  app.addHook('onRequest', app.requireApiKey);
  const scopeByRoute: Record<string, string> = {
    '/text': 'text', '/chat': 'chat', '/image': 'image', '/image-to-image': 'image',
    '/video-to-image': 'image', '/remove-background': 'image', '/inpaint': 'image',
    '/outpaint': 'image', '/controlnet': 'image', '/upscale': 'image', '/vision': 'vision',
    '/embed': 'embed', '/embedding': 'embed', '/ocr': 'ocr', '/video': 'video', '/workflow': 'workflow',
  };
  app.addHook('preHandler', async (req, reply) => {
    const requestProjectId = (req.body as { projectId?: string } | undefined)?.projectId;
    if (req.auth?.projectId && requestProjectId && requestProjectId !== req.auth.projectId) {
      return reply.code(403).send(fail('PROJECT_FORBIDDEN', 'A API key nao pertence ao projeto informado'));
    }
    const routeUrl = req.routeOptions.url;
    const routePath = routeUrl?.replace(/^\/v1/, '');
    const typeToScope = (type: string | undefined, payload?: Record<string, unknown>) =>
      type === 'ocr' ? 'ocr' : type === 'embedding' ? 'embed' : type === 'image' ? 'image' :
        type === 'vision' || payload?.task === 'vision' ? 'vision' : 'text';
    const hasScope = (scope: string) => req.auth?.scopes.includes('*') || req.auth?.scopes.includes(scope);
    if ((routePath?.startsWith('/reverse/') || routePath === '/reverse/connectors' || routePath?.startsWith('/memory/')) && !hasScope('workflow')) {
      return reply.code(403).send(fail('INSUFFICIENT_SCOPE', 'A API key nao possui o escopo workflow'));
    }
    if (routePath === '/jobs' && req.method === 'POST') {
      const job = req.body as { type?: string; payload?: Record<string, unknown> } | undefined;
      const required = typeToScope(job?.type, job?.payload);
      if (!hasScope(required)) return reply.code(403).send(fail('INSUFFICIENT_SCOPE', `A API key nao possui o escopo ${required}`));
      return;
    }
    if (routePath === '/jobs/batch' && req.method === 'POST') {
      const jobs = (req.body as { jobs?: Array<{ type?: string; payload?: Record<string, unknown> }> } | undefined)?.jobs ?? [];
      const requiredScopes = new Set(jobs.map((j) => typeToScope(j.type, j.payload)));
      for (const required of requiredScopes) {
        if (!hasScope(required)) return reply.code(403).send(fail('INSUFFICIENT_SCOPE', `A API key nao possui o escopo ${required}`));
      }
      return;
    }
    const required = routePath ? scopeByRoute[routePath] : undefined;
    if (!required || hasScope(required)) return;
    return reply.code(403).send(fail('INSUFFICIENT_SCOPE', `A API key nao possui o escopo ${required}`));
  });

  const rlConfig = {
    rateLimit: { max: env.RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW_MS },
  };

  await app.register(reverseRoutes);
  await app.register(memoryRoutes);

  // ---------- Texto ----------
  app.post('/text', { config: rlConfig, schema: { tags: ['v1'] } }, async (req, reply) => {
    const body = textSchema.parse(req.body);
    const release = body.execution === 'async' ? undefined : acquireSynchronousTextSlot();
    if (!release) {
      if (body.execution === 'sync') {
        return reply.code(429).send(fail('SYNC_CAPACITY_REACHED', 'Capacidade sincrona ocupada; use execution=auto ou async'));
      }
      const queued = await enqueueWithTiming('text', body, {
        tenantId: req.auth?.tenantId,
        projectId: req.auth?.projectId,
        callback: body.callback,
      });
      return reply.code(202).send({
        success: true, ...queued, status: 'waiting', execution: 'async',
        ...queueEntryPopulation(queued.queue),
      });
    }
    try {
      return await execute('text', body, (p) => p.generateText(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    } finally {
      release();
    }
  });

  // ---------- Chat ----------
  app.post('/chat', { config: rlConfig, schema: { tags: ['v1'] } }, async (req) => {
    const body = chatSchema.parse(req.body);
    return execute('chat', body, (p) => p.chat(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
  });

  // ---------- Imagem ----------
  app.post('/image', { config: rlConfig, schema: { tags: ['v1'] } }, async (req, reply) => {
    const body = imageSchema.parse(req.body);
    if (!body.wait) {
      const queued = await enqueueWithTiming('image', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
      return reply.code(202).send({
        success: true, ...queued, status: 'waiting', ...queueEntryPopulation(queued.queue),
      });
    }
    const response = await execute('image', body, (p) => p.generateImage(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return persistImageResponse(response, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId, prompt: body.prompt, kind: body.image ? 'image-to-image' : 'text-to-image', seed: body.seed });
  });

  app.post('/image-to-image', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req, reply) => {
    const raw = imageToImageSchema.parse(req.body);
    const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider };
    if (!body.wait) {
      // Geracao de imagem costuma passar de 100s - o Cloudflare (mesmo em
      // tunel) mata a conexao do cliente nesse ponto (524) antes da imagem
      // ficar pronta. wait:false devolve o jobId na hora; o chamador consulta
      // GET /v1/jobs/:id ate status=completed, sem nunca segurar uma conexao
      // HTTP proxiada por mais de 100s.
      const queued = await enqueueWithTiming('image', { ...body, image: body.image, denoise: body.strength }, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
      return reply.code(202).send({
        success: true, ...queued, status: 'waiting', ...queueEntryPopulation(queued.queue),
      });
    }
    const response = await execute('image', body, (p) => (p as unknown as ImageProvider).imageToImage(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return persistImageResponse(response, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId, prompt: body.prompt, kind: 'image-to-image', seed: body.seed });
  });

  // ---------- Galeria: N imagens de vitrine a partir de 1 foto do produto ----------
  // Sempre assincrono (5 imagens x 30-90s cada facilmente passa de 5-8min,
  // muito acima do limite de ~100s de qualquer proxy na frente da API).
  app.post('/image-gallery', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req, reply) => {
    const raw = imageGallerySchema.parse(req.body);
    const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider, __kind: 'gallery' };
    const queued = await enqueueWithTiming('image', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return reply.code(202).send({
        success: true, ...queued, status: 'waiting', ...queueEntryPopulation(queued.queue),
      });
  });

  // ---------- Angulo real de camera (Stable Zero123 - novel view synthesis) ----------
  // Sem prompt de texto: o angulo e controlado por elevation/azimuth. Sempre
  // assincrono pelo mesmo motivo da galeria acima.
  app.post('/image-multiangle', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req, reply) => {
    const raw = multiAngleSchema.parse(req.body);
    const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider, __kind: 'multiangle' };
    const queued = await enqueueWithTiming('image', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return reply.code(202).send({
        success: true, ...queued, status: 'waiting', ...queueEntryPopulation(queued.queue),
      });
  });

  app.post('/video-to-image', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req, reply) => {
    const raw = videoToImageSchema.parse(req.body);
    const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider, __kind: 'video-to-image' };
    const queued = await enqueueWithTiming('image', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return reply.code(202).send({
        success: true, ...queued, status: 'waiting', ...queueEntryPopulation(queued.queue),
      });
  });

  app.post('/video', { config: rlConfig, schema: { tags: ['v1', 'video'] } }, async (req, reply) => {
    const raw = videoToImageSchema.parse(req.body);
    const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider, __kind: 'video-to-image' };
    const queued = await enqueueWithTiming('image', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return reply.code(202).send({
        success: true, ...queued, status: 'waiting', ...queueEntryPopulation(queued.queue),
      });
  });
  app.post('/remove-background', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req) => {
    const raw = removeBackgroundSchema.parse(req.body); const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider };
    const response = await execute('image', body, (p) => (p as unknown as ImageProvider).removeBackground(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return persistImageResponse(response, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId, kind: 'remove-background' });
  });

  app.post('/inpaint', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req) => {
    const raw = inpaintSchema.parse(req.body); const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider };
    const response = await execute('image', body, (p) => (p as unknown as ImageProvider).inpaint(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return persistImageResponse(response, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId, prompt: body.prompt, kind: 'inpaint', seed: body.seed });
  });

  app.post('/outpaint', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req) => {
    const raw = outpaintSchema.parse(req.body); const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider };
    const response = await execute('image', body, (p) => (p as unknown as ImageProvider).outpaint(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return persistImageResponse(response, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId, prompt: body.prompt, kind: 'outpaint', seed: body.seed });
  });

  app.post('/controlnet', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req) => {
    const raw = controlnetSchema.parse(req.body); const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider };
    const response = await execute('image', body, (p) => (p as unknown as ImageProvider).controlnet(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return persistImageResponse(response, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId, prompt: body.prompt, kind: 'controlnet-' + body.controlType, seed: body.seed });
  });

  // ---------- Upscale ----------
  app.post('/upscale', { config: rlConfig, schema: { tags: ['v1'] } }, async (req, reply) => {
    const body = upscaleSchema.parse(req.body);
    if (!body.wait) {
      const queued = await enqueueWithTiming('image', { ...body, __kind: 'upscale' }, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
      return reply.code(202).send({
        success: true, ...queued, status: 'waiting', ...queueEntryPopulation(queued.queue),
      });
    }
    const response = await execute('upscale', body, (p) => p.upscale(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return persistImageResponse(response, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId, kind: 'upscale' });
  });

  // ---------- Vision ----------
  app.post('/vision', { config: rlConfig, schema: { tags: ['v1'] } }, async (req) => {
    const body = visionSchema.parse(req.body);
    return execute('vision', body, (p) => p.vision(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
  });

  // ---------- Embeddings ----------
  app.post('/embed', { config: rlConfig, schema: { tags: ['v1'] } }, async (req) => {
    const body = embedSchema.parse(req.body);
    return execute('embed', body, (p) => p.embed(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
  });

  app.post('/embedding', { config: rlConfig, schema: { tags: ['v1'] } }, async (req) => {
    const body = embedSchema.parse(req.body);
    return execute('embed', body, (p) => p.embed(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
  });
  // ---------- OCR ----------
  app.post('/ocr', { config: rlConfig, schema: { tags: ['v1'] } }, async (req, reply) => {
    const body = ocrSchema.parse(req.body);
    if (!body.wait) {
      const queued = await enqueueWithTiming('ocr', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
      return reply.code(202).send({
        success: true, ...queued, status: 'waiting', ...queueEntryPopulation(queued.queue),
      });
    }
    const { result } = await enqueueAndWait('ocr', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return result;
  });

  // ---------- Jobs assincronos (SEO, traducao, classificacao...) ----------
  app.post('/jobs', { config: rlConfig, schema: { tags: ['v1'] } }, async (req, reply) => {
    const body = jobSchema.parse(req.body);
    const queued = await enqueueWithTiming(resolveJobQueue(body.type, body.payload), { ...body.payload, minQuality: body.payload.minQuality ?? body.minQuality, strictQuality: body.payload.strictQuality ?? body.strictQuality }, {
      tenantId: req.auth?.tenantId,
      projectId: req.auth?.projectId,
      priority: body.priority,
      callback: body.callback,
    });
    return reply.code(202).send({
      success: true, ...queued, status: 'waiting', ...queueEntryPopulation(queued.queue),
    });
  });

  app.get('/jobs/:id', { schema: { tags: ['v1'] } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job || (job.tenantId && job.tenantId !== req.auth?.tenantId) || (req.auth?.projectId && job.projectId !== req.auth.projectId)) {
      return reply.code(404).send(fail('JOB_NOT_FOUND', `job ${id} nao encontrado`));
    }
    const queue = job.status === 'waiting' || job.status === 'active'
      ? await queueTiming(job.queue as QueueName, job.id)
      : undefined;
    const population = populationSummary([{ id: job.id, status: job.status }]);
    return {
      success: true,
      jobId: job.id,
      status: job.status,
      populationStatus: population.populationStatus,
      message: population.message,
      result: job.result,
      error: job.error,
      durationMs: job.durationMs,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      queue,
    };
  });

  // ---------- Lote: enfileira N jobs numa unica chamada HTTP ----------
  // Pensado pra catalogo em lote (ex: Lovable "populate-catalog" com 500+
  // produtos) - em vez do chamador precisar espacar centenas de POST
  // /v1/jobs individuais (e esbarrar no rate limit por chave), manda tudo
  // de uma vez aqui. A fila (BullMQ, concorrencia configurada via
  // WORKER_CONCURRENCY/IMAGE_WORKER_CONCURRENCY) absorve e processa no
  // proprio ritmo sustentavel. A API aceita ate 10 mil, mas grava em blocos
  // pequenos para nao abrir 10 mil operacoes simultaneas em Postgres/Redis.
  app.post('/jobs/batch', { config: rlConfig, schema: { tags: ['v1'] } }, async (req, reply) => {
    const body = z.object({ jobs: z.array(jobSchema).min(1).max(env.BATCH_MAX_JOBS) }).parse(req.body);
    const jobIds: string[] = [];
    const rejected: Array<{ index: number; error: string }> = [];
    for (let offset = 0; offset < body.jobs.length; offset += env.BATCH_ENQUEUE_CONCURRENCY) {
      const chunk = body.jobs.slice(offset, offset + env.BATCH_ENQUEUE_CONCURRENCY);
      const results = await Promise.all(chunk.map(async (j, index) => {
        try {
          return { ok: true as const, jobId: await enqueue(resolveJobQueue(j.type, j.payload), { ...j.payload, minQuality: j.payload.minQuality ?? j.minQuality, strictQuality: j.payload.strictQuality ?? j.strictQuality }, {
            tenantId: req.auth?.tenantId,
            projectId: req.auth?.projectId,
            priority: j.priority,
            callback: j.callback,
          }) };
        } catch (error) {
          return { ok: false as const, index: offset + index, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      for (const result of results) {
        if (result.ok) jobIds.push(result.jobId);
        else rejected.push({ index: result.index, error: result.error });
      }
    }
    const [queues, populationJobs] = await Promise.all([
      queueStats(),
      prisma.job.findMany({
        where: { id: { in: Array.from(new Set(jobIds)) } },
        select: { id: true, status: true },
      }),
    ]);
    const population = populationSummary(populationJobs, body.jobs.length, jobIds.length, rejected.length);
    return reply.code(rejected.length ? 207 : 202).send({
      success: rejected.length === 0,
      status: population.populationStatus,
      message: population.message,
      population,
      jobIds,
      count: jobIds.length,
      rejected,
      queues,
    });
  });

  // ---------- Status de varios jobs numa unica chamada ----------
  // Evita ter que fazer 1 GET /jobs/:id por item pra desenhar progresso de
  // um lote grande - manda os ids que importam e recebe o status de todos.
  app.post('/jobs/status', { config: rlConfig, schema: { tags: ['v1'] } }, async (req) => {
    const body = z.object({ ids: z.array(z.string().min(1)).min(1).max(env.BATCH_MAX_JOBS) }).parse(req.body);
    const jobs = await prisma.job.findMany({
      where: {
        id: { in: body.ids },
        ...(req.auth?.tenantId ? { tenantId: req.auth.tenantId } : {}),
        ...(req.auth?.projectId ? { projectId: req.auth.projectId } : {}),
      },
      select: { id: true, status: true, result: true, error: true, finishedAt: true },
    });
    const population = populationSummary(jobs, body.ids.length, jobs.length, body.ids.length - jobs.length);
    return { success: true, status: population.populationStatus, message: population.message, population, jobs };
  });

  // ---------- Resumo agregado da fila (sem precisar de admin) ----------
  // Quantos jobs estao esperando/rodando/completos/falhos por tipo -
  // pra mostrar barra de progresso/ETA de um lote grande sem precisar
  // consultar cada job individualmente.
  app.get('/jobs/stats', { schema: { tags: ['v1'] } }, async () => {
    const queues = await queueStats();
    return { success: true, population: queuePopulationSummary(queues), queues };
  });

  app.get('/images/:id/file', { schema: { tags: ['v1', 'image'] } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const image = await prisma.image.findUnique({ where: { id } });
    if (!image || (image.tenantId && image.tenantId !== req.auth?.tenantId) || (req.auth?.projectId && image.projectId !== req.auth.projectId)) return reply.code(404).send(fail('IMAGE_NOT_FOUND', 'Imagem nao encontrada'));
    const file = path.join(process.env.IMAGE_STORAGE_PATH ?? '/app/storage/images', `${id}.png`);
    try { return reply.type('image/png').send(await readFile(file)); }
    catch { return reply.code(404).send(fail('IMAGE_FILE_NOT_FOUND', 'Arquivo da imagem nao encontrado')); }
  });

  app.post('/history', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req) => {
    const query = z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(req.body ?? {});
    const images = await prisma.image.findMany({ where: { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId }, orderBy: { createdAt: 'desc' }, take: query.limit });
    return { success: true, images: images.map((image) => ({ ...image, seed: image.seed?.toString() })) };
  });

  app.post('/workflow', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req, reply) => {
    if (!registry.has('comfyui')) return reply.code(503).send(fail('COMFYUI_NOT_CONFIGURED', 'ComfyUI nao configurado'));
    const comfy = registry.get('comfyui') as ComfyUIProvider;
    const health = await comfy.health();
    if (!health.ok) return reply.code(503).send(fail('COMFYUI_OFFLINE', 'ComfyUI offline. Verifique servidor e URL.'));
    const body = z.object({ workflowId: z.string().optional(), graph: z.record(z.any()).optional() })
      .refine((value) => value.workflowId || value.graph, 'Informe workflowId ou graph').parse(req.body);
    let graph = body.graph;
    if (body.workflowId) {
      const workflow = await prisma.imageWorkflow.findFirst({ where: { id: body.workflowId, enabled: true, provider: 'comfyui' } });
      if (!workflow) return reply.code(404).send(fail('WORKFLOW_NOT_FOUND', 'Workflow nao encontrado ou desativado'));
      graph = workflow.graph as Record<string, any>;
    }
    const started = Date.now();
    const result = await comfy.executeWorkflow(graph as any);
    return { success: true, provider: 'comfyui', model: result.model, executionTime: Date.now() - started, cached: false, tokens: {}, result: result.result };
  });

  app.post('/audio', { config: rlConfig, schema: { tags: ['v1'] } }, async (_req, reply) =>
    reply.code(501).send(fail('AUDIO_PROVIDER_NOT_CONFIGURED', 'Nenhum provider de audio foi configurado')),
  );
  // ---------- Modelos ----------
  app.get('/models', { schema: { tags: ['v1'] } }, async (req) => {
    const { provider } = req.query as { provider?: string };
    const providers = provider ? [registry.get(provider)] : registry.list();
    const results = await Promise.all(
      providers.map(async (p) => {
        try {
          return { provider: p.name, models: await p.models() };
        } catch (err) {
          return { provider: p.name, models: [], error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
    return { success: true, providers: results };
  });

  // ---------- Providers ----------
  app.get('/providers', { schema: { tags: ['v1'] } }, async () => {
    const results = await Promise.all(
      registry.list().map(async (p) => ({
        name: p.name,
        capabilities: p.capabilities,
        health: await p.health(),
      })),
    );
    return { success: true, defaults: registry.getDefaults(), providers: results };
  });

  // ---------- ComfyUI: progresso / fila / cancelamento ----------
  app.get('/comfyui/queue', { schema: { tags: ['v1'] } }, async (_req, reply) => {
    const comfy = comfyOrFail(reply);
    if (!comfy) return;
    return { success: true, queue: await comfy.getQueue() };
  });

  app.get('/comfyui/progress/:promptId', { schema: { tags: ['v1'] } }, async (req, reply) => {
    const comfy = comfyOrFail(reply);
    if (!comfy) return;
    const { promptId } = req.params as { promptId: string };
    return { success: true, progress: await comfy.getProgress(promptId) };
  });

  app.post('/comfyui/cancel', { schema: { tags: ['v1'] } }, async (req, reply) => {
    const comfy = comfyOrFail(reply);
    if (!comfy) return;
    const { promptId } = (req.body ?? {}) as { promptId?: string };
    await comfy.cancel(promptId);
    return { success: true };
  });

  function comfyOrFail(reply: any): ComfyUIProvider | null {
    if (!registry.has('comfyui')) {
      reply.code(400).send(fail('PROVIDER_NOT_FOUND', 'comfyui nao esta configurado'));
      return null;
    }
    return registry.get('comfyui') as ComfyUIProvider;
  }
}
