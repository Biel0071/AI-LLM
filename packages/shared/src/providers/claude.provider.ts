import Anthropic from '@anthropic-ai/sdk';
import { BaseProvider, parseImageInput } from './base.provider';
import {
  Capability,
  ChatInput,
  ChatMessage,
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

/** Anthropic (Messages API) via REST */
export class ClaudeProvider extends BaseProvider {
  readonly name = 'anthropic';
  readonly capabilities: Capability[] = ['chat', 'vision'];

  constructor(private readonly config: ClaudeConfig) {
    super();
  }

  private mapUsage(usage: any): TokenUsage | undefined {
    if (!usage) return undefined;
    return {
      prompt: usage.input_tokens,
      completion: usage.output_tokens,
      total: (usage.input_tokens || 0) + (usage.output_tokens || 0),
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
    const model = input.model ?? this.config.defaultModel ?? 'claude-3-opus-20240229';

    const systemMessages = input.messages.filter((m) => m.role === 'system');
    const system = systemMessages.length > 0 ? systemMessages.map((m) => m.content).join('\n\n') : undefined;

    const messages = input.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        if (!m.images?.length) return { role: m.role, content: m.content };
        const blocks: any[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const img of m.images) {
          const parsed = parseImageInput(img);
          if (parsed.kind === 'url') {
            throw new ProviderError(
              this.name,
              'URL images are not natively supported by Anthropic Messages API without fetching first. Send base64.',
              'UNSUPPORTED_IMAGE_FORMAT',
              400,
            );
          }
          let mediaType = parsed.mimeType;
          if (mediaType === 'image/jpg') mediaType = 'image/jpeg';
          if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
            mediaType = 'image/jpeg';
          }
          blocks.push({
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: parsed.data },
          });
        }
        return { role: m.role, content: blocks };
      });

    const body: Record<string, unknown> = {
      model,
      messages,
      max_tokens: input.maxTokens ?? 4096,
    };
    if (system) body.system = system;
    if (input.temperature !== undefined) body.temperature = input.temperature;

    const data = await this.http<any>('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body,
    });

    if (data.type === 'error') {
      throw new ProviderError(this.name, data.error?.message ?? 'API Error', data.error?.type ?? 'API_ERROR');
    }

    const text = (data.content ?? [])
      .filter((b: any) => b.type === 'text')
      .map((b: any) => b.text)
      .join('');

    return {
      result: { message: { role: 'assistant', content: text } },
      model,
      tokens: this.mapUsage(data.usage),
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

  async models(): Promise<ModelInfo[]> {
    return [
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
      { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
      { id: 'claude-3-5-sonnet-20240620', name: 'Claude 3.5 Sonnet' },
    ];
  }
}
