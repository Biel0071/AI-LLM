import { BaseProvider } from './base.provider';
import {
  Capability,
  GenerateImageInput,
  GenerateTextInput,
  GeneratedImage,
  HealthStatus,
  ModelInfo,
  ProviderError,
  ProviderResult,
} from '../types';

export interface ReplicateConfig {
  apiToken: string;
  imageModel?: string;
  textModel?: string;
}

/** Replicate (api.replicate.com) — texto e imagem via predictions */
export class ReplicateProvider extends BaseProvider {
  readonly name = 'replicate';
  readonly capabilities: Capability[] = ['text', 'image'];

  private readonly base = 'https://api.replicate.com/v1';

  constructor(private readonly config: ReplicateConfig) {
    super();
  }

  private get headers(): Record<string, string> {
    return { authorization: `Bearer ${this.config.apiToken}` };
  }

  private async predict(model: string, input: Record<string, unknown>): Promise<any> {
    const created = await this.http<any>(`${this.base}/models/${model}/predictions`, {
      method: 'POST',
      headers: { ...this.headers, prefer: 'wait=60' },
      body: { input },
      timeoutMs: 90_000,
    });

    let prediction = created;
    const deadline = Date.now() + 300_000;
    while (
      prediction?.status &&
      !['succeeded', 'failed', 'canceled'].includes(prediction.status) &&
      Date.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 2000));
      prediction = await this.http<any>(`${this.base}/predictions/${prediction.id}`, {
        headers: this.headers,
        timeoutMs: 15_000,
      });
    }
    if (prediction?.status !== 'succeeded') {
      throw new ProviderError(this.name, `prediction ${prediction?.status}: ${prediction?.error ?? ''}`);
    }
    return prediction;
  }

  override async generateText(input: GenerateTextInput): Promise<ProviderResult<{ text: string }>> {
    const model = input.model ?? this.config.textModel;
    if (!model) throw new ProviderError(this.name, 'no text model configured', 'MODEL_REQUIRED', 400);
    const prediction = await this.predict(model, {
      prompt: input.prompt,
      system_prompt: input.system,
      max_tokens: input.maxTokens,
      temperature: input.temperature,
    });
    const out = prediction.output;
    const text = Array.isArray(out) ? out.join('') : String(out ?? '');
    return { result: { text }, model, raw: { id: prediction.id, metrics: prediction.metrics } };
  }

  override async generateImage(input: GenerateImageInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    const model = input.model ?? this.config.imageModel;
    if (!model) throw new ProviderError(this.name, 'no image model configured', 'MODEL_REQUIRED', 400);
    const prediction = await this.predict(model, {
      prompt: input.prompt,
      width: input.width,
      height: input.height,
      num_outputs: input.batch ?? 1,
      seed: input.seed,
    });
    const out = prediction.output;
    const urls: string[] = Array.isArray(out) ? out : [String(out)];
    const images: GeneratedImage[] = urls.filter(Boolean).map((url) => ({ url }));
    return { result: { images }, model, raw: { id: prediction.id, metrics: prediction.metrics } };
  }

  override async health(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      await this.http<any>(`${this.base}/account`, { headers: this.headers, timeoutMs: 10_000 });
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async models(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    if (this.config.textModel) models.push({ id: this.config.textModel, capabilities: ['text'] });
    if (this.config.imageModel) models.push({ id: this.config.imageModel, capabilities: ['image'] });
    return models;
  }
}
