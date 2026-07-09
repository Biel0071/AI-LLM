import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { fail, ImageProvider } from '@ai-platform/shared';
import { execute, registry } from '../../services/ai.service';
import { enqueue, queueStats } from '../../services/queue.service';
import { persistImageResponse } from '../../services/image-storage.service';
import { prisma } from '../../lib/prisma';

export async function imagesRoutes(secured: FastifyInstance): Promise<void> {
  secured.post('/image/generate', { schema: { tags: ['admin', 'image'] } }, async (req, reply) => {
    const body = z.object({
      operation: z.enum(['text-to-image','image-to-image','video-to-image','remove-background','upscale']),
      prompt: z.string().default(''), negativePrompt: z.string().optional(), image: z.string().optional(), video: z.string().optional(),
      action: z.enum(['custom','new-angle','new-position','new-lighting','new-color','new-background','new-clothing','model-wearing','catalog','mockup','lifestyle','marketplace']).default('custom'),
      provider: z.string().optional(), model: z.string().optional(), strength: z.number().min(0).max(1).default(0.6),
      width: z.number().int().min(64).max(4096).default(1024), height: z.number().int().min(64).max(4096).default(1024),
      frameCount: z.number().int().min(1).max(20).default(4), scale: z.number().min(1).max(8).default(4),
    }).parse(req.body);
    const presets: Record<string,string> = {
      'new-angle':'product photography from a new professional camera angle','new-position':'reposition the product naturally while preserving identity',
      'new-lighting':'premium studio lighting, realistic shadows','new-color':'change only the requested product color, preserve materials',
      'new-background':'replace background professionally, preserve product exactly','new-clothing':'change clothing while preserving person and product',
      'model-wearing':'realistic fashion model wearing the exact product','catalog':'clean ecommerce catalog, white background, studio lighting',
      'mockup':'professional realistic commercial mockup','lifestyle':'premium lifestyle advertising photography','marketplace':'marketplace-ready product photo, centered, clean background', custom:'',
    };
    const prompt = [body.prompt, presets[body.action]].filter(Boolean).join('. ');
    const provider = body.provider === 'auto' ? undefined : body.provider;
    if (body.operation === 'video-to-image') {
      if (!body.video) return reply.code(400).send(fail('VIDEO_REQUIRED','Envie um video'));
      const jobId = await enqueue('image', { ...body, prompt, provider, __kind: 'video-to-image' });
      return reply.code(202).send({ success: true, jobId, status: 'waiting' });
    }
    if (body.operation === 'image-to-image' && !body.image) return reply.code(400).send(fail('IMAGE_REQUIRED','Envie uma imagem'));
    let response;
    if (body.operation === 'remove-background') {
      if (!body.image) return reply.code(400).send(fail('IMAGE_REQUIRED','Envie uma imagem'));
      response = await execute('image', { ...body, provider }, (p) => (p as unknown as ImageProvider).removeBackground({ image: body.image!, provider, model: body.model }), { cache: false });
    } else if (body.operation === 'upscale') {
      if (!body.image) return reply.code(400).send(fail('IMAGE_REQUIRED','Envie uma imagem'));
      response = await execute('upscale', { ...body, provider }, (p) => p.upscale({ image: body.image!, scale: body.scale, model: body.model }), { cache: false });
    } else if (body.operation === 'image-to-image') {
      response = await execute('image', { ...body, prompt, provider }, (p) => (p as unknown as ImageProvider).imageToImage({ ...body, image: body.image!, prompt, provider }), { cache: true });
    } else {
      response = await execute('image', { ...body, prompt, provider }, (p) => p.generateImage({ ...body, prompt }), { cache: true });
    }
    return persistImageResponse(response, { prompt, kind: body.action, seed: undefined });
  });

  secured.get('/image/providers', { schema: { tags: ['admin', 'image'] } }, async () => ({
    success: true,
    providers: await Promise.all(registry.list().filter((p) => p.capabilities.includes('image')).map(async (p) => ({
      name: p.name, capabilities: p.capabilities, health: await p.health(), models: await p.models().catch(() => []),
      queue: typeof (p as any).queue === 'function' ? await (p as any).queue().catch(() => null) : null,
    }))),
  }));

  secured.get('/image/:id/file', { schema: { tags: ['admin', 'image'] } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const image = await prisma.image.findUnique({ where: { id } });
    if (!image) return reply.code(404).send(fail('IMAGE_NOT_FOUND', 'Imagem nao encontrada'));
    try { return reply.type('image/png').send(await readFile(path.join(process.env.IMAGE_STORAGE_PATH ?? '/app/storage/images', `${id}.png`))); }
    catch { return reply.code(404).send(fail('IMAGE_FILE_NOT_FOUND', 'Arquivo nao encontrado')); }
  });

  secured.get('/image/history', { schema: { tags: ['admin', 'image'] } }, async (req) => {
    const query = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const images = await prisma.image.findMany({ orderBy: { createdAt: 'desc' }, take: query.limit, include: { tenant: { select: { name: true } } } });
    return { success: true, images: images.map((image) => ({ ...image, seed: image.seed?.toString() })) };
  });

  secured.get('/image/queue', { schema: { tags: ['admin', 'image'] } }, async () => ({
    success: true,
    queue: (await queueStats()).find((q) => q.name === 'image'),
    jobs: await prisma.job.findMany({ where: { queue: 'image' }, orderBy: { createdAt: 'desc' }, take: 100 }),
  }));

  secured.get('/image/analytics', { schema: { tags: ['admin', 'image'] } }, async () => {
    const [total, byProvider, byKind] = await Promise.all([
      prisma.image.count(), prisma.image.groupBy({ by: ['provider'], _count: { _all: true } }),
      prisma.image.groupBy({ by: ['kind'], _count: { _all: true } }),
    ]);
    return { success: true, total, byProvider, byKind };
  });
}
