import { z } from 'zod';

const optionalAutoString = z.preprocess(
  (value) => typeof value === 'string' && value.toLowerCase() === 'auto' ? undefined : value,
  z.string().min(1).optional(),
);

export const callbackSchema = z.object({
  url: z.string().url().max(2_048),
  /** Segredo usado para assinar o corpo em x-ai-platform-signature. */
  secret: z.string().min(16).max(512).optional(),
});

const common = {
  provider: optionalAutoString,
  model: optionalAutoString,
  /**
   * Pista opcional de tarefa (ex.: "translation", "classification", "seo",
   * "vision") para o roteamento automatico escolher o melhor modelo quando
   * `model` nao for informado. Sem efeito se `model` for explicito.
   */
  task: z.enum(['general', 'chat', 'quality', 'classification', 'translation', 'seo', 'ocr', 'vision', 'embed']).optional(),
  cache: z.boolean().optional().default(true),
  fallback: z.boolean().optional().default(true),
  projectId: z.string().min(1).optional(),
  callback: callbackSchema.optional(),
  /** Nota minima exigida antes de persistir/enviar o resultado. */
  minQuality: z.number().int().min(0).max(100).optional().default(90),
  strictQuality: z.boolean().optional().default(true),
};

export const textSchema = z.object({
  prompt: z.string().min(1).max(100_000),
  system: z.string().max(50_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128_000).optional(),
  json: z.boolean().optional(),
  /** auto enfileira durante picos; sync nunca espera em memoria; async sempre enfileira. */
  execution: z.enum(['auto', 'sync', 'async']).optional().default('auto'),
  ...common,
});

export const chatSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string(),
        images: z.array(z.string()).optional(),
      }),
    )
    .min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128_000).optional(),
  ...common,
});

export const imageSchema = z.object({
  prompt: z.string().min(1).max(10_000),
  negativePrompt: z.string().max(10_000).optional(),
  width: z.number().int().min(64).max(4096).optional(),
  height: z.number().int().min(64).max(4096).optional(),
  steps: z.number().int().min(1).max(150).optional(),
  cfgScale: z.number().min(0).max(30).optional(),
  seed: z.number().int().optional(),
  image: z.string().optional(),
  denoise: z.number().min(0).max(1).optional(),
  batch: z.number().int().min(1).max(8).optional(),
  removeBackground: z.boolean().optional(),
  /** true = espera o resultado; false = retorna jobId imediatamente */
  wait: z.boolean().optional().default(false),
  ...common,
});

export const imageToImageSchema = z.object({
  image: z.string().min(1), prompt: z.string().min(1).max(10_000),
  negativePrompt: z.string().max(10_000).optional(), strength: z.number().min(0).max(1).default(0.6),
  seed: z.number().int().optional(), width: z.number().int().min(64).max(4096).optional(),
  height: z.number().int().min(64).max(4096).optional(), steps: z.number().int().min(1).max(150).optional(),
  cfgScale: z.number().min(0).max(30).optional(),
  /** true = espera o resultado; false = retorna jobId imediatamente (recomendado: geracao de imagem passa de 100s e o Cloudflare mata a conexao antes) */
  wait: z.boolean().optional().default(false),
  ...common,
});
export const inpaintSchema = imageToImageSchema.extend({ mask: z.string().min(1) });
export const outpaintSchema = imageToImageSchema.extend({
  top: z.number().int().min(0).max(2048).default(64), right: z.number().int().min(0).max(2048).default(64),
  bottom: z.number().int().min(0).max(2048).default(64), left: z.number().int().min(0).max(2048).default(64),
});
export const controlnetSchema = imageToImageSchema.extend({
  controlType: z.enum(['pose', 'depth', 'canny', 'lineart', 'softedge']),
  controlModel: z.string().optional(), weight: z.number().min(0).max(2).default(1),
});
export const removeBackgroundSchema = z.object({ image: z.string().min(1), ...common });
export const videoToImageSchema = z.object({
  video: z.string().min(1), prompt: z.string().min(1), negativePrompt: z.string().optional(),
  frameCount: z.number().int().min(1).max(20).default(5), strength: z.number().min(0).max(1).default(0.6),
  seed: z.number().int().optional(), ...common,
});

/**
 * Preenche N imagens de vitrine a partir de UMA foto do produto, aplicando
 * img2img com prompts de enquadramento/contexto variados por item (nao e
 * rotacao 3D real - o checkpoint instalado e SD1.5-class/img2img, que
 * preserva a composicao da imagem de entrada; nao existe modelo multi-view
 * instalado para gerar um angulo fisico diferente de verdade).
 */
export const imageGallerySchema = z.object({
  image: z.string().min(1),
  prompt: z.string().min(1).max(10_000),
  negativePrompt: z.string().max(10_000).optional(),
  count: z.number().int().min(1).max(10).optional().default(5),
  strength: z.number().min(0).max(1).optional(),
  seed: z.number().int().optional(),
  steps: z.number().int().min(1).max(150).optional(),
  cfgScale: z.number().min(0).max(30).optional(),
  ...common,
});

/**
 * Novel view synthesis de verdade (Stable Zero123): gera a MESMA foto vista
 * de outro angulo fisico de camera, sem prompt de texto (o modelo e
 * condicionado so pela imagem + elevation/azimuth). count=5 gera 5 vistas
 * espalhadas igualmente em 360 graus de azimute na mesma elevacao.
 */
export const multiAngleSchema = z.object({
  image: z.string().min(1),
  count: z.number().int().min(1).max(8).optional().default(5),
  elevation: z.number().min(-90).max(90).optional().default(0),
  width: z.number().int().min(64).max(1024).optional(),
  height: z.number().int().min(64).max(1024).optional(),
  steps: z.number().int().min(1).max(150).optional(),
  cfgScale: z.number().min(0).max(30).optional(),
  seed: z.number().int().optional(),
  ...common,
});

export const upscaleSchema = z.object({
  image: z.string().min(1),
  scale: z.number().min(1).max(8).optional().default(4),
  wait: z.boolean().optional().default(false),
  ...common,
});

export const visionSchema = z.object({
  prompt: z.string().min(1).max(50_000),
  images: z.array(z.string().min(1)).min(1).max(10),
  maxTokens: z.number().int().min(1).max(128_000).optional(),
  ...common,
});

export const embedSchema = z.object({
  input: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(256)]),
  ...common,
});

export const ocrSchema = z.object({
  image: z.string().min(1),
  language: z.string().optional(),
  wait: z.boolean().optional().default(false),
  ...common,
});

export const jobSchema = z.object({
  type: z.enum(['text', 'vision', 'image', 'embedding', 'ocr', 'seo', 'translation', 'classification']),
  payload: z.record(z.unknown()),
  priority: z.number().int().min(1).max(10).optional(),
  projectId: z.string().min(1).optional(),
  callback: callbackSchema.optional(),
  /** Nota minima exigida antes de persistir/enviar o resultado. */
  minQuality: z.number().int().min(0).max(100).optional().default(90),
  strictQuality: z.boolean().optional().default(true),
});

export const seoSchema = z.object({
  product: z.string().min(1),
  description: z.string().optional(),
  language: z.string().optional().default('pt-BR'),
  ...common,
});

export const translationSchema = z.object({
  text: z.string().min(1),
  targetLanguage: z.string().min(2),
  sourceLanguage: z.string().optional(),
  ...common,
});

export const classificationSchema = z.object({
  text: z.string().min(1),
  categories: z.array(z.string().min(1)).min(2),
  ...common,
});

export type TextRequest = z.infer<typeof textSchema>;
export type ChatRequest = z.infer<typeof chatSchema>;
export type ImageRequest = z.infer<typeof imageSchema>;
export type UpscaleRequest = z.infer<typeof upscaleSchema>;
export type VisionRequest = z.infer<typeof visionSchema>;
export type EmbedRequest = z.infer<typeof embedSchema>;
export type OcrRequest = z.infer<typeof ocrSchema>;
export type JobRequest = z.infer<typeof jobSchema>;
