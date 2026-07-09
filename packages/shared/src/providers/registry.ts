import { AIProvider, Capability, ProviderError } from '../types';
import { A1111Provider } from './a1111.provider';
import { ClaudeProvider } from './claude.provider';
import { ComfyUIProvider } from './comfyui.provider';
import { GeminiProvider } from './gemini.provider';
import { OllamaProvider } from './ollama.provider';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { ReplicateProvider } from './replicate.provider';
import { SDAPIProvider } from './sdapi.provider';

export class ProviderRegistry {
  private providers = new Map<string, AIProvider>();
  private defaults: Partial<Record<Capability, string>> = {};

  register(provider: AIProvider): this {
    this.providers.set(provider.name, provider);
    return this;
  }

  setDefault(capability: Capability, providerName: string): this {
    this.defaults[capability] = providerName;
    return this;
  }

  get(name: string): AIProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new ProviderError(
        name,
        `provider not registered. Available: ${[...this.providers.keys()].join(', ') || '(none)'}`,
        'PROVIDER_NOT_FOUND',
        400,
      );
    }
    return provider;
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  list(): AIProvider[] {
    return [...this.providers.values()];
  }

  getDefaults(): Partial<Record<Capability, string>> {
    return { ...this.defaults };
  }

  /**
   * Resolve o provider para uma capacidade:
   * provider explicito na requisicao > default configurado > primeiro
   * provider registrado que suporta a capacidade.
   */
  resolve(capability: Capability, requestedProvider?: string): AIProvider {
    if (requestedProvider) {
      const provider = this.get(requestedProvider);
      if (!provider.capabilities.includes(capability)) {
        throw new ProviderError(
          requestedProvider,
          `does not support capability "${capability}"`,
          'CAPABILITY_NOT_SUPPORTED',
          400,
        );
      }
      return provider;
    }
    const defaultName = this.defaults[capability];
    if (defaultName && this.has(defaultName)) {
      const provider = this.get(defaultName);
      if (provider.capabilities.includes(capability)) return provider;
    }
    const fallback = this.list().find((p) => p.capabilities.includes(capability));
    if (!fallback) {
      throw new ProviderError(
        'registry',
        `no provider registered for capability "${capability}"`,
        'NO_PROVIDER_AVAILABLE',
        503,
      );
    }
    return fallback;
  }

  resolveCandidates(
    capability: Capability,
    requestedProvider?: string,
    fallbackOrder: string[] = [],
  ): AIProvider[] {
    const primary = this.resolve(capability, requestedProvider);
    const rank = new Map(fallbackOrder.map((name, index) => [name, index]));
    const rest = this.list()
      .filter((p) => p.name !== primary.name && p.capabilities.includes(capability))
      .sort((a, b) =>
        (rank.get(a.name) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(b.name) ?? Number.MAX_SAFE_INTEGER),
      );
    return [primary, ...rest];
  }
}

export type Env = Record<string, string | undefined>;

/** Constroi o registry a partir das variaveis de ambiente. */
export function createRegistryFromEnv(env: Env): ProviderRegistry {
  const registry = new ProviderRegistry();

  if (env.OLLAMA_BASE_URL) {
    registry.register(
      new OllamaProvider({
        baseUrl: env.OLLAMA_BASE_URL,
        defaultModel: env.OLLAMA_DEFAULT_MODEL,
        embedModel: env.OLLAMA_EMBED_MODEL,
        visionModel: env.OLLAMA_VISION_MODEL,
        maxParallel: env.OLLAMA_NUM_PARALLEL ? Number(env.OLLAMA_NUM_PARALLEL) : undefined,
      }),
    );
  }

  if (env.OPENAI_API_KEY) {
    registry.register(
      new OpenAICompatibleProvider({
        name: 'openai',
        baseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
        apiKey: env.OPENAI_API_KEY,
        defaultModel: env.OPENAI_DEFAULT_MODEL ?? 'gpt-4o-mini',
        embedModel: env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small',
        imageModel: env.OPENAI_IMAGE_MODEL ?? 'dall-e-3',
        capabilities: ['text', 'chat', 'embed', 'vision', 'image'],
      }),
    );
  }

  if (env.GEMINI_API_KEY) {
    registry.register(
      new GeminiProvider({
        apiKey: env.GEMINI_API_KEY,
        baseUrl: env.GEMINI_BASE_URL,
        defaultModel: env.GEMINI_DEFAULT_MODEL,
        embedModel: env.GEMINI_EMBED_MODEL,
      }),
    );
  }

  if (env.ANTHROPIC_API_KEY) {
    registry.register(
      new ClaudeProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        defaultModel: env.CLAUDE_DEFAULT_MODEL ?? 'claude-opus-4-8',
      }),
    );
  }

  if (env.OPENROUTER_API_KEY) {
    registry.register(
      new OpenAICompatibleProvider({
        name: 'openrouter',
        baseUrl: env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1',
        apiKey: env.OPENROUTER_API_KEY,
        defaultModel: env.OPENROUTER_DEFAULT_MODEL,
        capabilities: ['text', 'chat', 'vision'],
      }),
    );
  }

  if (env.HUGGINGFACE_API_KEY) {
    registry.register(
      new OpenAICompatibleProvider({
        name: 'huggingface',
        baseUrl: env.HUGGINGFACE_BASE_URL ?? 'https://router.huggingface.co/v1',
        apiKey: env.HUGGINGFACE_API_KEY,
        defaultModel: env.HUGGINGFACE_DEFAULT_MODEL,
        capabilities: ['text', 'chat'],
      }),
    );
  }
  if (env.GROQ_API_KEY) {
    registry.register(
      new OpenAICompatibleProvider({
        name: 'groq',
        baseUrl: env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
        apiKey: env.GROQ_API_KEY,
        defaultModel: env.GROQ_DEFAULT_MODEL ?? 'llama-3.1-8b-instant',
        capabilities: ['text', 'chat'],
      }),
    );
  }

  if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
    registry.register(
      new OpenAICompatibleProvider({
        name: 'cloudflare',
        baseUrl: env.CLOUDFLARE_BASE_URL ??
          `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
        apiKey: env.CLOUDFLARE_API_TOKEN,
        defaultModel: env.CLOUDFLARE_DEFAULT_MODEL ?? '@cf/meta/llama-3.1-8b-instruct-fp8-fast',
        embedModel: env.CLOUDFLARE_EMBED_MODEL,
        capabilities: env.CLOUDFLARE_EMBED_MODEL
          ? ['text', 'chat', 'embed', 'vision']
          : ['text', 'chat', 'vision'],
      }),
    );
  }

  if (env.LMSTUDIO_BASE_URL) {
    registry.register(
      new OpenAICompatibleProvider({
        name: 'lmstudio',
        baseUrl: env.LMSTUDIO_BASE_URL,
        defaultModel: env.LMSTUDIO_DEFAULT_MODEL,
        capabilities: ['text', 'chat', 'embed', 'vision'],
      }),
    );
  }

  if (env.COMFYUI_BASE_URL) {
    registry.register(
      new ComfyUIProvider({
        baseUrl: env.COMFYUI_BASE_URL,
        checkpoint: env.COMFYUI_CHECKPOINT,
        upscaleModel: env.COMFYUI_UPSCALE_MODEL,
        zero123Checkpoint: env.COMFYUI_ZERO123_CHECKPOINT,
        timeoutMs: env.COMFYUI_TIMEOUT_MS ? Number(env.COMFYUI_TIMEOUT_MS) : undefined,
        lcmLoraName: env.COMFYUI_LCM_LORA,
      }),
    );
  }

  if (env.FORGE_BASE_URL) {
    registry.register(new A1111Provider({
      name: 'forge', baseUrl: env.FORGE_BASE_URL, defaultModel: env.FORGE_DEFAULT_MODEL,
    }));
  }

  if (env.A1111_BASE_URL) {
    registry.register(
      new A1111Provider({ baseUrl: env.A1111_BASE_URL, defaultModel: env.A1111_DEFAULT_MODEL }),
    );
  }

  if (env.SD_API_KEY) {
    registry.register(
      new SDAPIProvider({
        baseUrl: env.SD_API_BASE_URL ?? 'https://modelslab.com/api',
        apiKey: env.SD_API_KEY,
        text2imgPath: env.SD_API_TEXT2IMG_PATH,
      }),
    );
  }

  if (env.REPLICATE_API_TOKEN) {
    registry.register(
      new ReplicateProvider({
        apiToken: env.REPLICATE_API_TOKEN,
        imageModel: env.REPLICATE_IMAGE_MODEL,
        textModel: env.REPLICATE_TEXT_MODEL,
      }),
    );
  }

  const defaults: Array<[Capability, string | undefined]> = [
    ['text', env.DEFAULT_TEXT_PROVIDER],
    ['chat', env.DEFAULT_CHAT_PROVIDER],
    ['image', env.DEFAULT_IMAGE_PROVIDER],
    ['embed', env.DEFAULT_EMBED_PROVIDER],
    ['vision', env.DEFAULT_VISION_PROVIDER],
    ['upscale', env.DEFAULT_UPSCALE_PROVIDER],
  ];
  for (const [capability, name] of defaults) {
    if (name) registry.setDefault(capability, name);
  }

  return registry;
}
