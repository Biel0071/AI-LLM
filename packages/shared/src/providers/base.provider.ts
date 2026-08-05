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
  ProviderResponse,
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

  protected async *streamHttp(url: string, opts: HttpOptions = {}): AsyncGenerator<any, void, unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? this.defaultTimeoutMs);
    try {
      const res = await fetch(url, {
        method: opts.method ?? 'POST',
        headers: {
          'content-type': 'application/json',
          ...(opts.headers ?? {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new ProviderError(
          this.name,
          `HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
          'UPSTREAM_HTTP_ERROR',
          res.status >= 500 ? 502 : res.status,
        );
      }

      if (!res.body) {
        throw new ProviderError(this.name, 'No response body for stream', 'UPSTREAM_HTTP_ERROR', 502);
      }

      // Using readable Web Streams API
      const reader = (res.body as unknown as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') return;
          
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            try {
              yield JSON.parse(dataStr);
            } catch (e) {
              // Ignore parse errors on partial chunks
            }
          }
        }
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

  async generateText(_input: GenerateTextInput): Promise<ProviderResponse<{ text: string }>> {
    // Keep generateText for internal use, even though 'text' isn't a capability anymore
    // (chat takes its place).
    throw new ProviderError(this.name, 'text generation is not supported natively, use chat', 'NOT_SUPPORTED', 400, false);
  }
  async chat(_input: ChatInput): Promise<ProviderResponse<{ message: ChatMessage }>> {
    this.notSupported('chat');
  }

  /**
   * Helper to collect an AsyncIterable of ProviderChunk into a single ProviderResult.
   */
  protected async collectChunks(
    stream: AsyncIterable<import('../types').ProviderChunk>,
    model: string
  ): Promise<import('../types').ProviderResult<{ message: ChatMessage }>> {
    let text = '';
    let usage: import('../types').TokenUsage | undefined;
    for await (const chunk of stream) {
      if (chunk.type === 'delta' && chunk.text) {
        text += chunk.text;
      } else if (chunk.type === 'usage') {
        usage = { prompt: chunk.promptTokens, completion: chunk.completionTokens, total: chunk.totalTokens };
      }
    }
    return {
      result: { message: { role: 'assistant', content: text } },
      model,
      tokens: usage
    };
  }
  async generateImage(_input: GenerateImageInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    this.notSupported('image');
  }
  async embed(_input: EmbedInput): Promise<ProviderResult<{ embeddings: number[][] }>> {
    this.notSupported('embedding');
  }
  async vision(_input: VisionInput): Promise<ProviderResponse<{ text: string }>> {
    this.notSupported('vision');
  }
  async audio(_input: any): Promise<ProviderResult<{ text?: string; audio?: string; language?: string; confidence?: number; metadata?: unknown }>> {
    this.notSupported('audio');
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
