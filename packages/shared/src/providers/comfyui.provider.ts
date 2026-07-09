import { BaseProvider, parseImageInput } from './base.provider';
import {
  Capability,
  GenerateImageInput,
  GeneratedImage,
  HealthStatus,
  ModelInfo,
  ProviderError,
  ProviderResult,
  UpscaleInput,
} from '../types';
import type { ControlNetInput, ImageProvider, ImageToImageInput, InpaintInput, OutpaintInput, RemoveBackgroundInput, TextToImageInput } from '../image-provider';
import { globalGpuSemaphore } from '../gpu-semaphore';

export interface ComfyUIConfig {
  baseUrl: string;
  /** Checkpoint padrao (SDXL, Flux Schnell, Flux Dev, etc.) */
  checkpoint?: string;
  upscaleModel?: string;
  /** Checkpoint .ckpt do Stable Zero123 (novel view synthesis de verdade) */
  zero123Checkpoint?: string;
  timeoutMs?: number;
}

export interface MultiAngleInput {
  image: string;
  elevation?: number;
  azimuth?: number;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  model?: string;
}

type WorkflowGraph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

/**
 * Aplicado apenas quando o chamador NAO informa negativePrompt (undefined).
 * Envie "" explicitamente para gerar sem nenhum negative prompt.
 */
const DEFAULT_NEGATIVE_PROMPT =
  'blurry, low quality, worst quality, jpeg artifacts, deformed, disfigured, ' +
  'bad anatomy, extra limbs, mutated hands, watermark, signature, text, logo';

/**
 * ComfyUI: text2img, img2img, upscale, consulta de progresso/fila e
 * cancelamento. Funciona com qualquer checkpoint instalado (SDXL, Flux
 * Schnell/Dev, SD1.5...) — o campo "model" da requisicao seleciona o
 * checkpoint dinamicamente.
 */
export class ComfyUIProvider extends BaseProvider implements ImageProvider {
  readonly name = 'comfyui';
  readonly capabilities: Capability[] = ['image', 'upscale'];

  constructor(private readonly config: ComfyUIConfig) {
    super();
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private get timeoutMs(): number {
    return this.config.timeoutMs ?? 300_000;
  }

  // ---------- Workflows ----------

  private buildTxt2Img(input: GenerateImageInput, checkpoint: string): WorkflowGraph {
    const seed = input.seed ?? Math.floor(Math.random() * 2 ** 32);
    return {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
      '2': {
        class_type: 'CLIPTextEncode',
        inputs: { text: input.prompt, clip: ['1', 1] },
      },
      '3': {
        class_type: 'CLIPTextEncode',
        inputs: { text: input.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT, clip: ['1', 1] },
      },
      '4': {
        class_type: 'EmptyLatentImage',
        inputs: {
          width: input.width ?? 1024,
          height: input.height ?? 1024,
          batch_size: input.batch ?? 1,
        },
      },
      '5': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['4', 0],
          seed,
          steps: input.steps ?? 25,
          cfg: input.cfgScale ?? 7,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
          denoise: 1,
        },
      },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
      '7': {
        class_type: 'SaveImage',
        inputs: { images: ['6', 0], filename_prefix: 'aiplatform' },
      },
    };
  }

  private buildImg2Img(input: GenerateImageInput, checkpoint: string, uploadedName: string): WorkflowGraph {
    const seed = input.seed ?? Math.floor(Math.random() * 2 ** 32);
    return {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: checkpoint } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: input.prompt, clip: ['1', 1] } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: input.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT, clip: ['1', 1] } },
      '8': { class_type: 'LoadImage', inputs: { image: uploadedName } },
      '9': { class_type: 'VAEEncode', inputs: { pixels: ['8', 0], vae: ['1', 2] } },
      '5': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          positive: ['2', 0],
          negative: ['3', 0],
          latent_image: ['9', 0],
          seed,
          steps: input.steps ?? 25,
          cfg: input.cfgScale ?? 7,
          sampler_name: 'dpmpp_2m',
          scheduler: 'karras',
          denoise: input.denoise ?? 0.6,
        },
      },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
      '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'aiplatform' } },
    };
  }

  /**
   * Novel view synthesis de verdade via Stable Zero123: dado 1 foto do
   * objeto, gera a imagem como ela apareceria de outro angulo de camera
   * (elevation/azimuth em graus), sem depender de prompt de texto - o
   * modelo e condicionado so pela imagem + angulo.
   */
  private buildZero123View(
    uploadedName: string,
    checkpoint: string,
    opts: { width: number; height: number; elevation: number; azimuth: number; steps: number; cfgScale: number; seed: number },
  ): WorkflowGraph {
    return {
      '1': { class_type: 'ImageOnlyCheckpointLoader', inputs: { ckpt_name: checkpoint } },
      '8': { class_type: 'LoadImage', inputs: { image: uploadedName } },
      '10': {
        class_type: 'StableZero123_Conditioning',
        inputs: {
          clip_vision: ['1', 1],
          init_image: ['8', 0],
          vae: ['1', 2],
          width: opts.width,
          height: opts.height,
          batch_size: 1,
          elevation: opts.elevation,
          azimuth: opts.azimuth,
        },
      },
      '5': {
        class_type: 'KSampler',
        inputs: {
          model: ['1', 0],
          positive: ['10', 0],
          negative: ['10', 1],
          latent_image: ['10', 2],
          seed: opts.seed,
          steps: opts.steps,
          cfg: opts.cfgScale,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1,
        },
      },
      '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
      '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'aiplatform_zero123' } },
    };
  }

  private buildUpscale(uploadedName: string, upscaleModel: string): WorkflowGraph {
    return {
      '1': { class_type: 'LoadImage', inputs: { image: uploadedName } },
      '2': { class_type: 'UpscaleModelLoader', inputs: { model_name: upscaleModel } },
      '3': {
        class_type: 'ImageUpscaleWithModel',
        inputs: { upscale_model: ['2', 0], image: ['1', 0] },
      },
      '4': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'aiplatform_upscale' } },
    };
  }

  // ---------- Execucao ----------

  /**
   * A rede local entre o container Docker e o ComfyUI nativo no Windows
   * (via host.docker.internal) tem falhas de conexao transitorias
   * ocasionais (ConnectionReset). Chamadas curtas (upload/submit) sao
   * baratas de repetir - poucas tentativas rapidas absorvem a maioria
   * desses blips sem custar tempo real de GPU (diferente de repetir a
   * geracao inteira do zero via retry do BullMQ).
   */
  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    throw lastErr;
  }

  private async uploadImage(image: string): Promise<string> {
    return this.withRetry(async () => {
      const parsed = parseImageInput(image);
      let buffer: Buffer;
      if (parsed.kind === 'url') {
        buffer = await this.httpBinary(parsed.data);
      } else {
        buffer = Buffer.from(parsed.data, 'base64');
      }
      const form = new FormData();
      const name = `aiplatform_${Date.now()}.png`;
      form.append('image', new Blob([new Uint8Array(buffer)], { type: 'image/png' }), name);
      const res = await fetch(this.url('/upload/image'), { method: 'POST', body: form, signal: AbortSignal.timeout(this.timeoutMs) });
      if (!res.ok) throw new ProviderError(this.name, `image upload failed: HTTP ${res.status}`);
      const data: any = await res.json();
      return data?.name ?? name;
    });
  }

  private async submit(workflow: WorkflowGraph): Promise<string> {
    return this.withRetry(async () => {
      const data = await this.http<any>(this.url('/prompt'), {
        method: 'POST',
        body: { prompt: workflow, client_id: 'ai-platform' },
      });
      const promptId = data?.prompt_id;
      if (!promptId) throw new ProviderError(this.name, `submit failed: ${JSON.stringify(data).slice(0, 300)}`);
      return promptId;
    });
  }

  private async waitForResult(promptId: string): Promise<GeneratedImage[]> {
    const deadline = Date.now() + this.timeoutMs;
    let consecutiveNetworkErrors = 0;
    while (Date.now() < deadline) {
      let history: any;
      try {
        history = await this.http<any>(this.url(`/history/${promptId}`), { timeoutMs: 15_000 });
        consecutiveNetworkErrors = 0;
      } catch (err) {
        // Uma unica tentativa de polling falhando (ex: ConnectionResetError
        // transitorio na rede local Docker<->host) NAO deve derrubar a
        // geracao inteira - a imagem pode estar quase pronta e o proximo
        // poll, 1.5s depois, teria sucesso. So desiste de verdade apos
        // varias falhas seguidas (rede genuinamente fora, nao um blip).
        consecutiveNetworkErrors++;
        if (consecutiveNetworkErrors >= 15) throw err;
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const entry = history?.[promptId];
      if (entry) {
        if (entry.status?.status_str === 'error') {
          throw new ProviderError(this.name, `generation failed: ${JSON.stringify(entry.status?.messages ?? '').slice(0, 500)}`);
        }
        const images: GeneratedImage[] = [];
        for (const nodeOutput of Object.values<any>(entry.outputs ?? {})) {
          for (const img of nodeOutput?.images ?? []) {
            const buf = await this.httpBinary(
              this.url(
                `/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder ?? '')}&type=${encodeURIComponent(img.type ?? 'output')}`,
              ),
            );
            images.push({ base64: buf.toString('base64'), mimeType: 'image/png' });
          }
        }
        if (images.length) return images;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Desistir aqui sem remover da fila deixa o workflow orfao rodando/
    // pendente no ComfyUI - ele continua ocupando um slot serial do
    // servidor mesmo que ninguem mais espere o resultado, atrasando TODOS
    // os proximos prompts (foi a causa raiz de uma fila real de imagens
    // travada: um prompt_id ja marcado como "failed" havia muito tempo
    // ainda aparecia em queue_pending). So remove da fila de PENDENTES -
    // nao usa /interrupt aqui, que derrubaria o que estiver rodando agora
    // mesmo que seja de outro cliente/request.
    await this.http(this.url('/queue'), { method: 'POST', body: { delete: [promptId] } }).catch(() => undefined);
    throw new ProviderError(this.name, `timeout waiting for prompt ${promptId}`, 'TIMEOUT', 504);
  }

  /**
   * Submete e espera o resultado segurando o semaforo global de GPU -
   * Ollama e ComfyUI sao processos separados competindo pela mesma placa;
   * sem essa coordenacao, texto e imagem rodando "em paralelo" brigam por
   * VRAM ao mesmo tempo e ambos ficam muito mais lentos do que testados
   * isoladamente (chegando a estourar timeouts que funcionam bem sozinhos).
   */
  private async submitAndWait(workflow: WorkflowGraph): Promise<GeneratedImage[]> {
    const releaseGpu = await globalGpuSemaphore.acquire();
    try {
      const promptId = await this.submit(workflow);
      return await this.waitForResult(promptId);
    } finally {
      releaseGpu();
    }
  }

  /**
   * Gera a MESMA foto do produto vista de outro angulo de camera de verdade
   * (Stable Zero123 - novel view synthesis), nao uma restilizacao img2img.
   * Sem prompt de texto: o angulo e controlado por elevation/azimuth (graus).
   */
  async generateMultiAngleView(input: MultiAngleInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    const checkpoint = input.model ?? this.config.zero123Checkpoint;
    if (!checkpoint) {
      throw new ProviderError(this.name, 'no zero123 checkpoint configured (COMFYUI_ZERO123_CHECKPOINT)', 'MODEL_REQUIRED', 400);
    }
    const uploaded = await this.uploadImage(input.image);
    const workflow = this.buildZero123View(uploaded, checkpoint, {
      width: input.width ?? 256,
      height: input.height ?? 256,
      elevation: input.elevation ?? 0,
      azimuth: input.azimuth ?? 0,
      steps: input.steps ?? 50,
      cfgScale: input.cfgScale ?? 3,
      seed: input.seed ?? Math.floor(Math.random() * 2 ** 32),
    });
    const images = await this.submitAndWait(workflow);
    return { result: { images }, model: checkpoint, raw: {} };
  }

  async executeWorkflow(workflow: WorkflowGraph): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    if (!workflow || typeof workflow !== 'object' || !Object.keys(workflow).length) {
      throw new ProviderError(this.name, 'workflow JSON vazio ou invalido', 'INVALID_WORKFLOW', 400);
    }
    const images = await this.submitAndWait(workflow);
    return { result: { images }, model: 'custom-workflow', raw: {} };
  }
  override async generateImage(input: GenerateImageInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    const checkpoint = input.model ?? this.config.checkpoint;
    if (!checkpoint) throw new ProviderError(this.name, 'no checkpoint configured', 'MODEL_REQUIRED', 400);

    let workflow: WorkflowGraph;
    if (input.image) {
      const uploaded = await this.uploadImage(input.image);
      workflow = this.buildImg2Img(input, checkpoint, uploaded);
    } else {
      workflow = this.buildTxt2Img(input, checkpoint);
    }
    const images = await this.submitAndWait(workflow);
    return { result: { images }, model: checkpoint, raw: {} };
  }

  override async upscale(input: UpscaleInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    const model = input.model ?? this.config.upscaleModel ?? 'RealESRGAN_x4plus.pth';
    const uploaded = await this.uploadImage(input.image);
    const images = await this.submitAndWait(this.buildUpscale(uploaded, model));
    return { result: { images }, model, raw: {} };
  }

  async textToImage(input: TextToImageInput) { return this.generateImage(input); }
  async imageToImage(input: ImageToImageInput) { return this.generateImage({ ...input, image: input.image, denoise: input.strength }); }
  async videoToImage(frames: string[], input: Omit<ImageToImageInput, 'image'>) {
    const images: GeneratedImage[] = []; let model = input.model ?? this.config.checkpoint ?? 'default';
    for (const frame of frames) { const res = await this.imageToImage({ ...input, image: frame }); images.push(...res.result.images); model = res.model; }
    return { result: { images }, model };
  }
  async inpaint(_input: InpaintInput): Promise<never> { throw new ProviderError(this.name, 'inpaint requer workflow/custom nodes configurados', 'CAPABILITY_NOT_SUPPORTED', 400); }
  async outpaint(_input: OutpaintInput): Promise<never> { throw new ProviderError(this.name, 'outpaint requer workflow/custom nodes configurados', 'CAPABILITY_NOT_SUPPORTED', 400); }
  async controlnet(_input: ControlNetInput): Promise<never> { throw new ProviderError(this.name, 'controlnet requer nodes ControlNet instalados', 'CAPABILITY_NOT_SUPPORTED', 400); }
  async removeBackground(_input: RemoveBackgroundInput): Promise<never> { throw new ProviderError(this.name, 'remove-background requer node rembg instalado', 'CAPABILITY_NOT_SUPPORTED', 400); }
  async queue() { return this.getQueue(); }

  // ---------- Operacoes extras (fila / progresso / cancelamento) ----------

  async getQueue(): Promise<{ running: number; pending: number; raw: unknown }> {
    const data = await this.http<any>(this.url('/queue'), { timeoutMs: 10_000 });
    return {
      running: data?.queue_running?.length ?? 0,
      pending: data?.queue_pending?.length ?? 0,
      raw: data,
    };
  }

  async getProgress(promptId: string): Promise<{ done: boolean; raw: unknown }> {
    const history = await this.http<any>(this.url(`/history/${promptId}`), { timeoutMs: 10_000 });
    const entry = history?.[promptId];
    return { done: Boolean(entry?.outputs && Object.keys(entry.outputs).length), raw: entry ?? null };
  }

  async cancel(promptId?: string): Promise<void> {
    if (promptId) {
      await this.http(this.url('/queue'), { method: 'POST', body: { delete: [promptId] } });
    }
    await this.http(this.url('/interrupt'), { method: 'POST', body: {} });
  }

  override async health(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.http<any>(this.url('/system_stats'), { timeoutMs: 8_000 });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async models(): Promise<ModelInfo[]> {
    const data = await this.http<any>(this.url('/object_info/CheckpointLoaderSimple'), { timeoutMs: 15_000 });
    const list: string[] =
      data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ?? [];
    return list.map((id) => ({ id, name: id, capabilities: ['image'] as Capability[] }));
  }
}
