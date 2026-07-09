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
  textSchema,
  upscaleSchema,
  visionSchema,
} from '@ai-platform/shared';
import { execute, registry } from '../../services/ai.service';
import { enqueue, enqueueAndWait, QueueName } from '../../services/queue.service';
import { prisma } from '../../lib/prisma';
import { env } from '../../config/env';
import { persistImageResponse } from '../../services/image-storage.service';

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
    let required = routePath ? scopeByRoute[routePath] : undefined;
    if (routePath === '/jobs' && req.method === 'POST') {
      const type = (req.body as { type?: string } | undefined)?.type;
      required = type === 'ocr' ? 'ocr' : type === 'embedding' ? 'embed' : 'text';
    }
    if (!required || req.auth?.scopes.includes('*') || req.auth?.scopes.includes(required)) return;
    return reply.code(403).send(fail('INSUFFICIENT_SCOPE', `A API key nao possui o escopo ${required}`));
  });

  const rlConfig = {
    rateLimit: { max: env.RATE_LIMIT_MAX, timeWindow: env.RATE_LIMIT_WINDOW_MS },
  };

  // ---------- Texto ----------
  app.post('/text', { config: rlConfig, schema: { tags: ['v1'] } }, async (req) => {
    const body = textSchema.parse(req.body);
    return execute('text', body, (p) => p.generateText(body), { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
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
      const jobId = await enqueue('image', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
      return reply.code(202).send({ success: true, jobId, status: 'waiting' });
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
      const jobId = await enqueue('image', { ...body, image: body.image, denoise: body.strength }, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
      return reply.code(202).send({ success: true, jobId, status: 'waiting' });
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
    const jobId = await enqueue('image', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return reply.code(202).send({ success: true, jobId, status: 'waiting' });
  });

  // ---------- Angulo real de camera (Stable Zero123 - novel view synthesis) ----------
  // Sem prompt de texto: o angulo e controlado por elevation/azimuth. Sempre
  // assincrono pelo mesmo motivo da galeria acima.
  app.post('/image-multiangle', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req, reply) => {
    const raw = multiAngleSchema.parse(req.body);
    const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider, __kind: 'multiangle' };
    const jobId = await enqueue('image', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return reply.code(202).send({ success: true, jobId, status: 'waiting' });
  });

  app.post('/video-to-image', { config: rlConfig, schema: { tags: ['v1', 'image'] } }, async (req, reply) => {
    const raw = videoToImageSchema.parse(req.body);
    const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider, __kind: 'video-to-image' };
    const jobId = await enqueue('image', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return reply.code(202).send({ success: true, jobId, status: 'waiting' });
  });

  app.post('/video', { config: rlConfig, schema: { tags: ['v1', 'video'] } }, async (req, reply) => {
    const raw = videoToImageSchema.parse(req.body);
    const body = { ...raw, provider: raw.provider === 'auto' ? undefined : raw.provider, __kind: 'video-to-image' };
    const jobId = await enqueue('image', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return reply.code(202).send({ success: true, jobId, status: 'waiting' });
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
      const jobId = await enqueue('image', { ...body, __kind: 'upscale' }, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
      return reply.code(202).send({ success: true, jobId, status: 'waiting' });
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
      const jobId = await enqueue('ocr', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
      return reply.code(202).send({ success: true, jobId, status: 'waiting' });
    }
    const { result } = await enqueueAndWait('ocr', body, { tenantId: req.auth?.tenantId, projectId: req.auth?.projectId });
    return result;
  });

  // ---------- Jobs assincronos (SEO, traducao, classificacao...) ----------
  app.post('/jobs', { config: rlConfig, schema: { tags: ['v1'] } }, async (req, reply) => {
    const body = jobSchema.parse(req.body);
    const jobId = await enqueue(body.type as QueueName, body.payload, {
      tenantId: req.auth?.tenantId,
      priority: body.priority,
    });
    return reply.code(202).send({ success: true, jobId, status: 'waiting' });
  });

  app.get('/jobs/:id', { schema: { tags: ['v1'] } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job || (job.tenantId && job.tenantId !== req.auth?.tenantId) || (req.auth?.projectId && job.projectId !== req.auth.projectId)) {
      return reply.code(404).send(fail('JOB_NOT_FOUND', `job ${id} nao encontrado`));
    }
    return {
      success: true,
      jobId: job.id,
      status: job.status,
      result: job.result,
      error: job.error,
      durationMs: job.durationMs,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
    };
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
