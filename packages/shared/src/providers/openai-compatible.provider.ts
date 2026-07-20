import { BaseProvider, parseImageInput } from './base.provider';
import {
  Capability,
  ChatInput,
  ChatMessage,
  EmbedInput,
  GenerateImageInput,
  GenerateTextInput,
  GeneratedImage,
  ModelInfo,
  ProviderError,
  ProviderResult,
  TokenUsage,
  VisionInput,
} from '../types';

export interface OpenAICompatibleConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  defaultModel?: string;
  embedModel?: string;
  imageModel?: string;
  capabilities?: Capability[];
  extraHeaders?: Record<string, string>;
  /** Campos adicionais exigidos por APIs OpenAI-compatible (ex.: thinking do Kimi). */
  extraBody?: Record<string, unknown>;
  /** Alguns providers rejeitam qualquer temperatura diferente da fixa. */
  fixedTemperature?: number;
  omitTemperature?: boolean;
  extraBodyForModel?: (model: string) => Record<string, unknown>;
}

/**
 * Provider generico para qualquer API compativel com OpenAI:
 * OpenAI, OpenRouter, LM Studio, vLLM, LocalAI, etc.
 */
export class OpenAICompatibleProvider extends BaseProvider {
  readonly name: string;
  readonly capabilities: Capability[];

  constructor(protected readonly config: OpenAICompatibleConfig) {
    super();
    this.name = config.name;
    this.capabilities = config.capabilities ?? ['text', 'chat', 'embed', 'vision'];
  }

  protected get headers(): Record<string, string> {
    return {
      ...(this.config.apiKey ? { authorization: `Bearer ${this.config.apiKey}` } : {}),
      ...(this.config.extraHeaders ?? {}),
    };
  }

  protected url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private mapUsage(usage: any): TokenUsage | undefined {
    if (!usage) return undefined;
    return {
      prompt: usage.prompt_tokens,
      completion: usage.completion_tokens,
      total: usage.total_tokens,
    };
  }

  override async generateText(input: GenerateTextInput): Promise<ProviderResult<{ text: string }>> {
    const messages: ChatMessage[] = [];
    if (input.system) messages.push({ role: 'system', content: input.system });
    messages.push({ role: 'user', content: input.prompt });
    const res = await this.chat({
      messages,
      model: input.model,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });
    return { result: { text: res.result.message.content }, model: res.model, tokens: res.tokens, raw: res.raw };
  }

  override async chat(input: ChatInput): Promise<ProviderResult<{ message: ChatMessage }>> {
    const model = input.model ?? this.config.defaultModel;
    if (!model) throw new ProviderError(this.name, 'no model configured', 'MODEL_REQUIRED', 400);

    const messages = input.messages.map((m) => {
      if (!m.images?.length) return { role: m.role, content: m.content };
      return {
        role: m.role,
        content: [
          { type: 'text', text: m.content },
          ...m.images.map((img) => {
            const parsed = parseImageInput(img);
            const url = parsed.kind === 'url' ? parsed.data : `data:${parsed.mimeType};base64,${parsed.data}`;
            return { type: 'image_url', image_url: { url } };
          }),
        ],
      };
    });

    const body: Record<string, unknown> = {
      model, messages, ...(this.config.extraBody ?? {}), ...(this.config.extraBodyForModel?.(model) ?? {}),
    };
    if (!this.config.omitTemperature) {
      if (this.config.fixedTemperature !== undefined) body.temperature = this.config.fixedTemperature;
      else if (input.temperature !== undefined) body.temperature = input.temperature;
    }
    if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens;

    const data = await this.http<any>(this.url('/chat/completions'), {
      method: 'POST',
      headers: this.headers,
      body,
    });

    const content: string = data?.choices?.[0]?.message?.content ?? '';
    return {
      result: { message: { role: 'assistant', content } },
      model: data?.model ?? model,
      tokens: this.mapUsage(data?.usage),
      raw: data,
    };
  }

  override async vision(input: VisionInput): Promise<ProviderResult<{ text: string }>> {
    const res = await this.chat({
      messages: [{ role: 'user', content: input.prompt, images: input.images }],
      model: input.model,
      maxTokens: input.maxTokens,
    });
    return { result: { text: res.result.message.content }, model: res.model, tokens: res.tokens, raw: res.raw };
  }

  override async embed(input: EmbedInput): Promise<ProviderResult<{ embeddings: number[][] }>> {
    const model = input.model ?? this.config.embedModel ?? this.config.defaultModel;
    if (!model) throw new ProviderError(this.name, 'no embed model configured', 'MODEL_REQUIRED', 400);
    const data = await this.http<any>(this.url('/embeddings'), {
      method: 'POST',
      headers: this.headers,
      body: { model, input: input.input },
    });
    const embeddings: number[][] = (data?.data ?? []).map((d: any) => d.embedding);
    return { result: { embeddings }, model, tokens: this.mapUsage(data?.usage), raw: data };
  }

  override async generateImage(input: GenerateImageInput): Promise<ProviderResult<{ images: GeneratedImage[] }>> {
    if (!this.capabilities.includes('image')) this.notSupported('image');
    const model = input.model ?? this.config.imageModel;
    if (!model) throw new ProviderError(this.name, 'no image model configured', 'MODEL_REQUIRED', 400);
    const size =
      input.width && input.height ? `${input.width}x${input.height}` : '1024x1024';
    const data = await this.http<any>(this.url('/images/generations'), {
      method: 'POST',
      headers: this.headers,
      body: {
        model,
        prompt: input.prompt,
        n: input.batch ?? 1,
        size,
        response_format: 'b64_json',
      },
      timeoutMs: 300_000,
    });
    const images: GeneratedImage[] = (data?.data ?? []).map((d: any) => ({
      base64: d.b64_json,
      url: d.url,
      mimeType: 'image/png',
    }));
    return { result: { images }, model, raw: data };
  }

  async models(): Promise<ModelInfo[]> {
    const data = await this.http<any>(this.url('/models'), { headers: this.headers, timeoutMs: 15_000 });
    return (data?.data ?? []).map((m: any) => ({ id: m.id, name: m.id }));
  }
}
