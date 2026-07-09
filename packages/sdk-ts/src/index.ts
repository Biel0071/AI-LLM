/**
 * AI Platform SDK (TypeScript)
 *
 * ```ts
 * import { AIPlatform } from '@ai-platform/sdk';
 * const ai = new AIPlatform({ baseUrl: 'http://localhost:3000', apiKey: 'ap_...' });
 * const res = await ai.text({ prompt: 'Descreva um tenis de corrida' });
 * console.log(res.result.text);
 * ```
 */

export interface AIPlatformOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
}

export interface TokenUsage {
  prompt?: number;
  completion?: number;
  total?: number;
}

export interface StandardResponse<T = unknown> {
  success: boolean;
  provider: string;
  model: string;
  executionTime: number;
  tokens: TokenUsage | Record<string, never>;
  cached: boolean;
  result: T;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: string[];
}

export interface CommonParams {
  provider?: string;
  model?: string;
  cache?: boolean;
}

export interface JobStatus {
  success: boolean;
  jobId: string;
  status: 'waiting' | 'active' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

export class AIPlatformError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AIPlatformError';
  }
}

export class AIPlatform {
  constructor(private readonly options: AIPlatformOptions) {}

  private async request<T>(path: string, method: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 300_000);
    try {
      const res = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data: any = await res.json();
      if (!res.ok || data?.success === false) {
        throw new AIPlatformError(
          data?.error?.code ?? 'HTTP_ERROR',
          data?.error?.message ?? `HTTP ${res.status}`,
          res.status,
        );
      }
      return data as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Geracao de texto (nomes, descricoes, SEO, anuncios...) */
  text(params: { prompt: string; system?: string; maxTokens?: number; temperature?: number; json?: boolean } & CommonParams) {
    return this.request<StandardResponse<{ text: string }>>('/v1/text', 'POST', params);
  }

  /** Conversa multi-turno */
  chat(params: { messages: ChatMessage[]; maxTokens?: number; temperature?: number } & CommonParams) {
    return this.request<StandardResponse<{ message: ChatMessage }>>('/v1/chat', 'POST', params);
  }

  /** Geracao de imagens (text2img / img2img) */
  image(
    params: {
      prompt: string;
      negativePrompt?: string;
      width?: number;
      height?: number;
      steps?: number;
      seed?: number;
      image?: string;
      wait?: boolean;
    } & CommonParams,
  ) {
    return this.request<StandardResponse<{ images: Array<{ base64?: string; url?: string }> }>>(
      '/v1/image',
      'POST',
      params,
    );
  }

  /** Upscale de imagem */
  upscale(params: { image: string; scale?: number; wait?: boolean } & CommonParams) {
    return this.request<StandardResponse<{ images: Array<{ base64?: string; url?: string }> }>>(
      '/v1/upscale',
      'POST',
      params,
    );
  }

  /** Analise de imagem (multimodal) */
  vision(params: { prompt: string; images: string[]; maxTokens?: number } & CommonParams) {
    return this.request<StandardResponse<{ text: string }>>('/v1/vision', 'POST', params);
  }

  /** Embeddings */
  embed(params: { input: string | string[] } & CommonParams) {
    return this.request<StandardResponse<{ embeddings: number[][] }>>('/v1/embed', 'POST', params);
  }

  /** OCR (vision ou tesseract, conforme configuracao do servidor) */
  ocr(params: { image: string; language?: string; wait?: boolean } & CommonParams) {
    return this.request<StandardResponse<{ text: string }>>('/v1/ocr', 'POST', params);
  }

  /** Enfileira um job assincrono (seo, translation, classification...) */
  createJob(params: { type: string; payload: Record<string, unknown>; priority?: number }) {
    return this.request<{ success: boolean; jobId: string; status: string }>('/v1/jobs', 'POST', params);
  }

  /** Consulta status/resultado de um job */
  getJob(jobId: string) {
    return this.request<JobStatus>(`/v1/jobs/${jobId}`, 'GET');
  }

  /** Aguarda um job terminar (polling) */
  async waitJob(jobId: string, opts: { pollMs?: number; timeoutMs?: number } = {}): Promise<JobStatus> {
    const deadline = Date.now() + (opts.timeoutMs ?? 300_000);
    while (Date.now() < deadline) {
      const status = await this.getJob(jobId);
      if (status.status === 'completed' || status.status === 'failed') return status;
      await new Promise((r) => setTimeout(r, opts.pollMs ?? 2000));
    }
    throw new AIPlatformError('TIMEOUT', `job ${jobId} did not finish in time`);
  }

  /** Lista modelos disponiveis */
  models(provider?: string) {
    const qs = provider ? `?provider=${encodeURIComponent(provider)}` : '';
    return this.request<{ success: boolean; providers: Array<{ provider: string; models: unknown[] }> }>(
      `/v1/models${qs}`,
      'GET',
    );
  }

  /** Lista providers e health de cada um */
  providers() {
    return this.request<{ success: boolean; providers: unknown[] }>('/v1/providers', 'GET');
  }

  /** Health da plataforma */
  health() {
    return this.request<{ success: boolean; status: string }>('/v1/health', 'GET');
  }
}

export default AIPlatform;
