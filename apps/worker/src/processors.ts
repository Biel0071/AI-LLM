import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Job } from 'bullmq';
import {
  AIProvider,
  Capability,
  ImageProvider,
  ok,
  parseImageInput,
  pickModel,
  ProviderRegistry,
  StandardResponse,
  TaskHint,
} from '@ai-platform/shared';

const execFileAsync = promisify(execFile);

/**
 * A VPS tem RAM para ComfyUI ou Ollama com folga, mas manter os dois modelos
 * residentes durante a difusao provoca swap e quase dobra o tempo por imagem.
 * Antes de um job de imagem, libera somente modelos ociosos do Ollama. A proxima
 * chamada de texto recarrega sob demanda; provedores externos nao sao afetados.
 */
async function releaseOllamaMemoryForImage(): Promise<void> {
  const base = process.env.OLLAMA_BASE_URL?.replace(/\/$/, '');
  if (!base) return;
  try {
    const response = await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return;
    const data = await response.json() as { models?: Array<{ name?: string; model?: string }> };
    for (const loaded of data.models ?? []) {
      const model = loaded.name ?? loaded.model;
      if (!model) continue;
      await fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, keep_alive: 0 }),
        signal: AbortSignal.timeout(10_000),
      });
    }
  } catch {
    // Otimizacao best-effort: indisponibilidade do Ollama nunca bloqueia imagem.
  }
}

export type ProcessorFn = (job: Job, registry: ProviderRegistry) => Promise<StandardResponse>;

/** Executa a chamada de provider medindo tempo e envelopando a resposta. */
async function run<T>(
  provider: { name: string },
  fn: () => Promise<{ result: T; model: string; tokens?: { prompt?: number; completion?: number; total?: number } }>,
): Promise<StandardResponse<T>> {
  const start = Date.now();
  const res = await fn();
  return ok({
    provider: provider.name,
    model: res.model,
    executionTime: Date.now() - start,
    tokens: res.tokens,
    result: res.result,
  });
}

const fallbackOrder = (process.env.FREE_PROVIDER_ORDER ??
  'ollama,groq,gemini,cloudflare,openrouter,lmstudio')
  .split(',').map((name) => name.trim()).filter(Boolean);

/**
 * `task` e uma pista opcional para o roteamento automatico de modelo
 * (packages/shared/model-router.ts): quando o job nao especifica `model`
 * explicito, cada provider candidato recebe o melhor modelo para aquela
 * tarefa (ex.: classificacao/traducao/SEO usam um modelo rapido; vision/OCR
 * usa um modelo de visao de verdade).
 */
async function runWithFallback<T>(
  registry: ProviderRegistry,
  capability: Capability,
  requested: string | undefined,
  fn: (provider: AIProvider, routedModel: string | undefined) => Promise<{ result: T; model: string; tokens?: { prompt?: number; completion?: number; total?: number } }>,
  task?: TaskHint,
): Promise<StandardResponse<T>> {
  let lastError: unknown;
  for (const provider of registry.resolveCandidates(capability, requested, fallbackOrder)) {
    try {
      const routedModel = pickModel(capability, task, provider.name, process.env);
      return await run(provider, () => fn(provider, routedModel));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error(`No provider available for ${capability}`);
}

// ---------- Worker Texto ----------
export const textProcessor: ProcessorFn = async (job, registry) => {
  const data = job.data as { prompt: string; system?: string; provider?: string; model?: string; task?: TaskHint };
  return runWithFallback(registry, 'text', data.provider, (provider, routedModel) =>
    provider.generateText({ ...data, model: data.model ?? routedModel }), data.task ?? 'general',
  );
};

/**
 * Prompts de enquadramento/contexto usados para preencher a galeria a partir
 * de 1 foto. Nao e rotacao 3D real (o checkpoint instalado e img2img SD1.5-
 * class, que preserva a composicao da imagem de entrada) - e restyling
 * guiado por prompt pra dar variedade de vitrine a partir da mesma foto.
 */
const GALLERY_ANGLES = [
  'front view, product photography, centered composition, studio lighting',
  'close-up detail shot, macro photography, sharp focus',
  'three-quarter angle view, product photography',
  'lifestyle context photo, natural lighting, styled scene',
  'side profile view, product photography, clean background',
  'top-down flat lay photography',
  'back view, product photography',
  'in-use photo, lifestyle shot, natural setting',
];

/** Placeholder 1x1 sem foto vira text-to-image, em vez de falhar no LoadImage. */
function hasUsableSourceImage(image: unknown): image is string {
  if (typeof image !== 'string' || !image.trim()) return false;
  if (/^https?:\/\//i.test(image)) return true;
  try {
    const parsed = parseImageInput(image);
    if (parsed.kind === 'url') return true;
    return Buffer.from(parsed.data, 'base64').length >= 256;
  } catch {
    return false;
  }
}

// ---------- Worker Imagem (geracao + upscale) ----------
export const imageProcessor: ProcessorFn = async (job, registry) => {
  const data = job.data as Record<string, any>;
  await releaseOllamaMemoryForImage();
  if (data.__kind === 'multiangle') {
    const provider = registry.resolve('image', data.provider) as any;
    return run(provider, async () => {
      const count = Math.min(Math.max(Number(data.count) || 5, 1), 8);
      const elevation = Number(data.elevation) || 0;
      const images: any[] = [];
      let usedModel = data.model ?? 'stable_zero123';
      for (let i = 0; i < count; i++) {
        const azimuth = (360 / count) * i;
        const res = await provider.generateMultiAngleView({
          image: data.image,
          elevation,
          azimuth,
          width: data.width,
          height: data.height,
          steps: data.steps,
          cfgScale: data.cfgScale,
          seed: data.seed != null ? Number(data.seed) + i : undefined,
          model: data.model,
        });
        images.push(...res.result.images);
        usedModel = res.model;
      }
      return { result: { images }, model: usedModel };
    });
  }
  if (data.__kind === 'gallery') {
    const provider = registry.resolve('image', data.provider);
    return run(provider, async () => {
      const requestedCount = Math.min(Math.max(Number(data.count) || 5, 1), 10);
      const configuredMax = Math.min(Math.max(Number(process.env.GALLERY_MAX_IMAGES_PER_JOB) || 10, 1), 10);
      const count = Math.min(requestedCount, configuredMax);
      const sourceImage = hasUsableSourceImage(data.image) ? data.image : undefined;
      const images: any[] = [];
      let usedModel = data.model ?? 'unknown';
      for (let i = 0; i < count; i++) {
        const angle = GALLERY_ANGLES[i % GALLERY_ANGLES.length];
        const res = await provider.generateImage({
          ...data,
          image: sourceImage,
          prompt: `${data.prompt}, ${angle}`,
          denoise: data.strength ?? 0.35 + (i % 3) * 0.1,
          // Sem override: o provider aplica o perfil LCM da VPS (3 passos).
          steps: data.steps,
          seed: data.seed != null ? Number(data.seed) + i : undefined,
        } as any);
        images.push(...res.result.images);
        usedModel = res.model;
      }
      return { result: { images }, model: usedModel };
    });
  }
  if (data.__kind === 'video-to-image') {
    const dir = await mkdtemp(path.join(tmpdir(), 'aiplatform-video-'));
    try {
      const videoFile = path.join(dir, 'input.mp4');
      const raw = String(data.video).replace(/^data:video\/[a-z0-9+.-]+;base64,/i, '');
      await writeFile(videoFile, Buffer.from(raw, 'base64'));
      await execFileAsync('ffmpeg', ['-i', videoFile, '-vf', 'select=gt(scene\\,0.18)', '-vsync', 'vfr', '-frames:v', String(data.frameCount ?? 4), path.join(dir, 'frame_%03d.png')], { timeout: 180_000 });
      let files = (await readdir(dir)).filter((name) => name.startsWith('frame_')).sort();
      if (!files.length) {
        await execFileAsync('ffmpeg', ['-i', videoFile, '-vf', 'fps=1', '-frames:v', String(data.frameCount ?? 4), path.join(dir, 'frame_%03d.png')], { timeout: 180_000 });
        files = (await readdir(dir)).filter((name) => name.startsWith('frame_')).sort();
      }
      if (!files.length) throw new Error('video sem frames extraiveis');
      const frames = await Promise.all(files.map(async (name) => (await readFile(path.join(dir, name))).toString('base64')));
      return runWithFallback(registry, 'image', data.provider, (provider) =>
        (provider as unknown as ImageProvider).videoToImage(frames, data as any),
      );
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
  if (data.__kind === 'upscale') {
    return runWithFallback(registry, 'upscale', data.provider, (provider) =>
      provider.upscale({ image: data.image, scale: data.scale, model: data.model }),
    );
  }
  return runWithFallback(registry, 'image', data.provider, (provider) => provider.generateImage(data as any));
};

// ---------- Worker Embedding ----------
export const embeddingProcessor: ProcessorFn = async (job, registry) => {
  const data = job.data as { input: string | string[]; provider?: string; model?: string };
  return runWithFallback(registry, 'embed', data.provider, (provider, routedModel) =>
    provider.embed({ ...data, model: data.model ?? routedModel }), 'embed',
  );
};

// ---------- Worker OCR ----------
export const ocrProcessor: ProcessorFn = async (job, registry) => {
  const data = job.data as { image: string; language?: string; provider?: string; model?: string };
  const engine = process.env.OCR_ENGINE ?? 'vision';

  if (engine === 'tesseract') {
    const parsed = parseImageInput(data.image);
    if (parsed.kind === 'url') throw new Error('tesseract engine requires base64 image');
    const dir = await mkdtemp(path.join(tmpdir(), 'aiplatform-ocr-'));
    const file = path.join(dir, 'input.png');
    try {
      await writeFile(file, Buffer.from(parsed.data, 'base64'));
      const args = [file, 'stdout'];
      if (data.language) args.push('-l', data.language);
      const start = Date.now();
      const { stdout } = await execFileAsync('tesseract', args, { timeout: 120_000 });
      return ok({
        provider: 'tesseract',
        model: 'tesseract-cli',
        executionTime: Date.now() - start,
        result: { text: stdout.trim() },
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const prompt =
    'Extraia TODO o texto visivel nesta imagem (OCR). Responda apenas com o texto extraido, ' +
    'preservando quebras de linha. Nao adicione comentarios.' +
    (data.language ? ` Idioma esperado: ${data.language}.` : '');
  return runWithFallback(registry, 'vision', data.provider, (provider, routedModel) =>
    provider.vision({ prompt, images: [data.image], model: data.model ?? routedModel }), 'ocr',
  );
};

// ---------- Worker SEO ----------
export const seoProcessor: ProcessorFn = async (job, registry) => {
  const data = job.data as {
    product: string;
    description?: string;
    language?: string;
    provider?: string;
    model?: string;
  };
  const language = data.language ?? 'pt-BR';
  const prompt = [
    `Voce e um especialista em SEO e catalogacao para e-commerce. Idioma: ${language}.`,
    `Produto: ${data.product}`,
    data.description ? `Detalhes fornecidos: ${data.description}` : '',
    '',
    'Use seu conhecimento geral sobre este tipo de produto (material tipico, ' +
      'uso, publico-alvo, caracteristicas comuns da categoria) para escrever ' +
      'uma descricao completa e precisa - nao invente especificacoes tecnicas ' +
      'exclusivas (numero de serie, medidas exatas, etc.) que nao foram ' +
      'informadas, mas enriqueca com o que e tipicamente verdade sobre ' +
      'produtos dessa categoria.',
    '',
    'Regra de tamanhos (aplique com criterio, categoria por categoria):',
    '- Roupas, calcados e acessorios vestiveis (camisas, calcas, vestidos, ' +
      'jaquetas, tenis, sapatos, etc.) TEM variacao de tamanho -> preencha ' +
      '"hasVariableSizes": true e "sizes" com as opcoes tipicas da categoria ' +
      '(ex: ["PP","P","M","G","GG"] para roupas, numeracao para calcados).',
    '- Bolsas, acessorios nao vestiveis, eletronicos, moveis, decoracao, etc. ' +
      'NAO tem variacao de tamanho -> "hasVariableSizes": false e "sizes": null.',
    '',
    'Gere um JSON valido (sem markdown, sem comentarios) com exatamente estas chaves:',
    '{',
    '  "name": "nome comercial otimizado",',
    '  "title": "titulo SEO (max 60 caracteres)",',
    '  "description": "descricao completa do produto (2-3 paragrafos)",',
    '  "metaDescription": "meta description (max 155 caracteres)",',
    '  "slug": "slug-url-amigavel",',
    '  "category": "categoria sugerida",',
    '  "hasVariableSizes": true ou false,',
    '  "sizes": ["P", "M", "G"] ou null,',
    '  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],',
    '  "summary": "resumo em 1 frase",',
    '  "adCopy": "texto curto para anuncio"',
    '}',
  ].join('\n');

  const res = await runWithFallback(registry, 'text', data.provider, (provider, routedModel) =>
    provider.generateText({ prompt, model: data.model ?? routedModel, json: true }), 'seo',
  );
  // tenta estruturar o JSON gerado
  try {
    const text = (res.result as { text: string }).text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return { ...res, result: JSON.parse(jsonMatch[0]) };
  } catch {
    /* mantem texto cru se o modelo nao gerou JSON valido */
  }
  return res;
};

// ---------- Worker Traducao ----------
export const translationProcessor: ProcessorFn = async (job, registry) => {
  const data = job.data as {
    text: string;
    targetLanguage: string;
    sourceLanguage?: string;
    provider?: string;
    model?: string;
  };
  const prompt =
    `Traduza o texto a seguir para ${data.targetLanguage}` +
    (data.sourceLanguage ? ` (idioma de origem: ${data.sourceLanguage})` : '') +
    '. Responda APENAS com a traducao, sem explicacoes.\n\n' +
    data.text;
  return runWithFallback(registry, 'text', data.provider, (provider, routedModel) =>
    provider.generateText({ prompt, model: data.model ?? routedModel }), 'translation',
  );
};

// ---------- Worker Classificacao ----------
export const classificationProcessor: ProcessorFn = async (job, registry) => {
  const data = job.data as { text: string; categories: string[]; provider?: string; model?: string };
  const prompt =
    `Classifique o texto abaixo em UMA das categorias: ${data.categories.join(', ')}.\n` +
    'Responda APENAS com o nome exato da categoria.\n\n' +
    data.text;
  const res = await runWithFallback(registry, 'text', data.provider, (provider, routedModel) =>
    provider.generateText({ prompt, model: data.model ?? routedModel }), 'classification',
  );
  const raw = (res.result as { text: string }).text.trim();
  const category =
    data.categories.find((c) => raw.toLowerCase().includes(c.toLowerCase())) ?? raw;
  return { ...res, result: { category, raw } };
};

export const processors: Record<string, ProcessorFn> = {
  text: textProcessor,
  image: imageProcessor,
  embedding: embeddingProcessor,
  ocr: ocrProcessor,
  seo: seoProcessor,
  translation: translationProcessor,
  classification: classificationProcessor,
};
