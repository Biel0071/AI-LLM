import { BaseProvider } from './base.provider';
import {
  Capability,
  GenerateImageInput,
  GeneratedImage,
  HealthStatus,
  ModelInfo,
  ProviderError,
  ProviderResult,
} from '../types';

export interface SDAPIConfig {
  baseUrl: string;
  apiKey: string;
  text2imgPath?: string;
  defaultModel?: string;
}

/** Stable Diffusion API hospedada (modelslab.com / stablediffusionapi.com) */
export class SDAPIProvider extends BaseProvider {
  readonly name = 'sdapi';
  readonly capabilities: Capability[] = ['image'];

  constructor(private readonly config: SDAPIConfig) {
    super();
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
  }

  override async generateImage(input: GenerateImageInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    const path = this.config.text2imgPath ?? '/v3/text2img';
    const data = await this.http<any>(this.url(path), {
      method: 'POST',
      body: {
        key: this.config.apiKey,
        model_id: input.model ?? this.config.defaultModel,
        prompt: input.prompt,
        negative_prompt: input.negativePrompt ?? '',
        width: String(input.width ?? 1024),
        height: String(input.height ?? 1024),
        samples: String(input.batch ?? 1),
        num_inference_steps: String(input.steps ?? 20),
        guidance_scale: input.cfgScale ?? 7,
        seed: input.seed ?? null,
      },
      timeoutMs: 300_000,
    });

    if (data?.status === 'error') {
      throw new ProviderError(this.name, String(data?.message ?? 'generation error'));
    }
    const urls: string[] = data?.output ?? [];
    const images: GeneratedImage[] = urls.map((url) => ({ url, mimeType: 'image/png' }));
    return { result: { images }, model: input.model ?? this.config.defaultModel ?? 'default', raw: { status: data?.status, id: data?.id } };
  }

  override async health(): Promise<HealthStatus> {
    // API hospedada nao possui endpoint de health publico; valida config.
    return { ok: Boolean(this.config.apiKey), message: this.config.apiKey ? undefined : 'missing SD_API_KEY' };
  }

  async models(): Promise<ModelInfo[]> {
    return this.config.defaultModel ? [{ id: this.config.defaultModel }] : [];
  }
}
