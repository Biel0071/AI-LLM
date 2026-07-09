import {
  AIProvider,
  Capability,
  CapabilityNotSupportedError,
  ChatInput,
  ChatMessage,
  EmbedInput,
  GenerateImageInput,
  GenerateTextInput,
  GeneratedImage,
  HealthStatus,
  ModelInfo,
  ProviderError,
  ProviderResult,
  UpscaleInput,
  VisionInput,
} from '../types';

export interface HttpOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export abstract class BaseProvider implements AIProvider {
  abstract readonly name: string;
  abstract readonly capabilities: Capability[];

  protected defaultTimeoutMs = 120_000;

  protected async http<T = any>(url: string, opts: HttpOptions = {}): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.defaultTimeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          ...(opts.headers ?? {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        throw new ProviderError(
          this.name,
          `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
          'UPSTREAM_HTTP_ERROR',
          res.status >= 500 ? 502 : res.status,
        );
      }
      if (!text) return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as unknown as T;
      }
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError(this.name, msg, 'UPSTREAM_UNREACHABLE', 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  protected async httpBinary(url: string, opts: HttpOptions = {}): Promise<Buffer> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.defaultTimeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: opts.headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ProviderError(this.name, `HTTP ${res.status} ${res.statusText}`, 'UPSTREAM_HTTP_ERROR');
      }
      return Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(timeout);
    }
  }

  protected notSupported(capability: Capability): never {
    throw new CapabilityNotSupportedError(this.name, capability);
  }

  async generateText(_input: GenerateTextInput): Promise<ProviderResult<{ text: string }>> {
    this.notSupported('text');
  }
  async chat(_input: ChatInput): Promise<ProviderResult<{ message: ChatMessage }>> {
    this.notSupported('chat');
  }
  async generateImage(_input: GenerateImageInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    this.notSupported('image');
  }
  async upscale(_input: UpscaleInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    this.notSupported('upscale');
  }
  async embed(_input: EmbedInput): Promise<ProviderResult<{ embeddings: number[][] }>> {
    this.notSupported('embed');
  }
  async vision(_input: VisionInput): Promise<ProviderResult<{ text: string }>> {
    this.notSupported('vision');
  }

  async health(): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const models = await this.models();
      return { ok: true, latencyMs: Date.now() - start, modelCount: models.length };
    } catch (err) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  abstract models(): Promise<ModelInfo[]>;
}

/** Remove prefixo data:image/...;base64, e retorna { data, mimeType } */
export function parseImageInput(image: string): { kind: 'url' | 'base64'; data: string; mimeType: string } {
  if (/^https?:\/\//i.test(image)) return { kind: 'url', data: image, mimeType: 'image/png' };
  const dataUri = image.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  if (dataUri) return { kind: 'base64', data: dataUri[2], mimeType: dataUri[1] };
  return { kind: 'base64', data: image, mimeType: 'image/png' };
}
