import Anthropic from '@anthropic-ai/sdk';
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

export interface ClaudeConfig {
  apiKey: string;
  defaultModel?: string;
}

/**
 * Anthropic Claude via SDK oficial (@anthropic-ai/sdk).
 * Modelo padrao: claude-opus-4-8.
 *
 * Nota: nos modelos Opus 4.7+ os parametros de sampling (temperature/top_p)
 * foram removidos da API — por isso este provider nao os repassa.
 */
export class ClaudeProvider extends BaseProvider {
  readonly name = 'claude';
  readonly capabilities: Capability[] = ['text', 'chat', 'vision'];

  private client: Anthropic;

  constructor(private readonly config: ClaudeConfig) {
    super();
    this.client = new Anthropic({ apiKey: config.apiKey });
  }

  private model(model?: string): string {
    return model ?? this.config.defaultModel ?? 'claude-opus-4-8';
  }

  private toContent(m: ChatMessage): string | Anthropic.ContentBlockParam[] {
    if (!m.images?.length) return m.content;
    const blocks: Anthropic.ContentBlockParam[] = m.images.map((img) => {
      const parsed = parseImageInput(img);
      if (parsed.kind === 'url') {
        return { type: 'image', source: { type: 'url', url: parsed.data } };
      }
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: parsed.mimeType as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
          data: parsed.data,
        },
      };
    });
    blocks.push({ type: 'text', text: m.content });
    return blocks;
  }

  private async createMessage(
    messages: ChatMessage[],
    opts: { model?: string; maxTokens?: number } = {},
  ): Promise<ProviderResult<{ message: ChatMessage }>> {
    const model = this.model(opts.model);
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const conversation = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: this.toContent(m),
      }));

    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model,
        max_tokens: opts.maxTokens ?? 16000,
        system: system || undefined,
        messages: conversation,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ProviderError(this.name, msg, 'UPSTREAM_HTTP_ERROR', 502);
    }

    if (response.stop_reason === 'refusal') {
      throw new ProviderError(this.name, 'request refused by safety classifiers', 'REFUSED', 422);
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const tokens: TokenUsage = {
      prompt: response.usage.input_tokens,
      completion: response.usage.output_tokens,
      total: response.usage.input_tokens + response.usage.output_tokens,
    };

    return {
      result: { message: { role: 'assistant', content: text } },
      model: response.model,
      tokens,
      raw: { id: response.id, stop_reason: response.stop_reason },
    };
  }

  override async generateText(input: GenerateTextInput): Promise<ProviderResult<{ text: string }>> {
    const messages: ChatMessage[] = [];
    if (input.system) messages.push({ role: 'system', content: input.system });
    messages.push({ role: 'user', content: input.prompt });
    const res = await this.createMessage(messages, input);
    return { result: { text: res.result.message.content }, model: res.model, tokens: res.tokens, raw: res.raw };
  }

  override async chat(input: ChatInput): Promise<ProviderResult<{ message: ChatMessage }>> {
    return this.createMessage(input.messages, input);
  }

  override async vision(input: VisionInput): Promise<ProviderResult<{ text: string }>> {
    const res = await this.createMessage(
      [{ role: 'user', content: input.prompt, images: input.images }],
      { model: input.model, maxTokens: input.maxTokens },
    );
    return { result: { text: res.result.message.content }, model: res.model, tokens: res.tokens, raw: res.raw };
  }

  override async embed(_input: EmbedInput): Promise<ProviderResult<{ embeddings: number[][] }>> {
    this.notSupported('embed');
  }

  async models(): Promise<ModelInfo[]> {
    const page = await this.client.models.list();
    const models: ModelInfo[] = [];
    for (const m of page.data) {
      models.push({ id: m.id, name: m.display_name });
    }
    return models;
  }
}
