import { BaseProvider, parseImageInput } from './base.provider';
import {
  Capability,
  ChatInput,
  ChatMessage,
  EmbedInput,
  GenerateTextInput,
  ModelInfo,
  ProviderError,
  ProviderResult,
  TokenUsage,
  VisionInput,
} from '../types';

export interface GeminiConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  embedModel?: string;
}

/** Google Gemini via REST (generativelanguage.googleapis.com) */
export class GeminiProvider extends BaseProvider {
  readonly name = 'gemini';
  readonly capabilities: Capability[] = ['text', 'chat', 'embed', 'vision'];

  constructor(private readonly config: GeminiConfig) {
    super();
  }

  private url(path: string): string {
    const base = (this.config.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const sep = path.includes('?') ? '&' : '?';
    return `${base}${path}${sep}key=${this.config.apiKey}`;
  }

  private model(model?: string): string {
    const m = model ?? this.config.defaultModel ?? 'gemini-2.5-flash';
    return m.replace(/^models\//, '');
  }

  private mapUsage(data: any): TokenUsage | undefined {
    const u = data?.usageMetadata;
    if (!u) return undefined;
    return { prompt: u.promptTokenCount, completion: u.candidatesTokenCount, total: u.totalTokenCount };
  }

  private toParts(content: string, images?: string[]): unknown[] {
    const parts: unknown[] = [{ text: content }];
    for (const img of images ?? []) {
      const parsed = parseImageInput(img);
      if (parsed.kind === 'url') {
        parts.push({ file_data: { file_uri: parsed.data, mime_type: parsed.mimeType } });
      } else {
        parts.push({ inline_data: { mime_type: parsed.mimeType, data: parsed.data } });
      }
    }
    return parts;
  }

  private async generateContent(
    model: string,
    messages: ChatMessage[],
    opts: { temperature?: number; maxTokens?: number } = {},
  ): Promise<ProviderResult<{ message: ChatMessage }>> {
    const systemParts = messages.filter((m) => m.role === 'system').map((m) => ({ text: m.content }));
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: this.toParts(m.content, m.images),
      }));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: opts.temperature,
        maxOutputTokens: opts.maxTokens,
      },
    };
    if (systemParts.length) body.systemInstruction = { parts: systemParts };

    const data = await this.http<any>(this.url(`/v1beta/models/${model}:generateContent`), {
      method: 'POST',
      body,
      timeoutMs: 180_000,
    });

    const text: string = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((p: any) => p.text ?? '')
      .join('');
    return {
      result: { message: { role: 'assistant', content: text } },
      model,
      tokens: this.mapUsage(data),
      raw: data,
    };
  }

  override async generateText(input: GenerateTextInput): Promise<ProviderResult<{ text: string }>> {
    const messages: ChatMessage[] = [];
    if (input.system) messages.push({ role: 'system', content: input.system });
    messages.push({ role: 'user', content: input.prompt });
    const res = await this.generateContent(this.model(input.model), messages, input);
    return { result: { text: res.result.message.content }, model: res.model, tokens: res.tokens, raw: res.raw };
  }

  override async chat(input: ChatInput): Promise<ProviderResult<{ message: ChatMessage }>> {
    return this.generateContent(this.model(input.model), input.messages, input);
  }

  override async vision(input: VisionInput): Promise<ProviderResult<{ text: string }>> {
    const res = await this.generateContent(this.model(input.model), [
      { role: 'user', content: input.prompt, images: input.images },
    ], { maxTokens: input.maxTokens });
    return { result: { text: res.result.message.content }, model: res.model, tokens: res.tokens, raw: res.raw };
  }

  override async embed(input: EmbedInput): Promise<ProviderResult<{ embeddings: number[][] }>> {
    const model = (input.model ?? this.config.embedModel ?? 'text-embedding-004').replace(/^models\//, '');
    const texts = Array.isArray(input.input) ? input.input : [input.input];
    const data = await this.http<any>(this.url(`/v1beta/models/${model}:batchEmbedContents`), {
      method: 'POST',
      body: {
        requests: texts.map((t) => ({
          model: `models/${model}`,
          content: { parts: [{ text: t }] },
        })),
      },
    });
    const embeddings: number[][] = (data?.embeddings ?? []).map((e: any) => e.values);
    if (!embeddings.length) throw new ProviderError(this.name, 'empty embeddings response');
    return { result: { embeddings }, model, raw: data };
  }

  async models(): Promise<ModelInfo[]> {
    const data = await this.http<any>(this.url('/v1beta/models'), { timeoutMs: 15_000 });
    return (data?.models ?? []).map((m: any) => ({
      id: String(m.name ?? '').replace(/^models\//, ''),
      name: m.displayName,
      contextWindow: m.inputTokenLimit,
    }));
  }
}
