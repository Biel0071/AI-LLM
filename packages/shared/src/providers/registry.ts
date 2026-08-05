import { AIProvider, Capability, ProviderError } from '../types';
import { A1111Provider } from './a1111.provider';
import { ClaudeProvider } from './claude.provider';
import { ComfyUIProvider } from './comfyui.provider';
import { GeminiProvider } from './gemini.provider';
import { OllamaProvider } from './ollama.provider';
import { OpenAICompatibleProvider } from './openai-compatible.provider';
import { ReplicateProvider } from './replicate.provider';
import { SDAPIProvider } from './sdapi.provider';
import { MissionProvider } from './mission.provider';

export interface ProviderMetrics {
  priority: number;       // 1 = Local First, 2 = Cloud Second, 3 = Fallback Third
  health: number;         // 0.0 a 1.0 (1.0 = 100% healthy)
  latency: number;        // ms
  contextWindow: number;  // tokens
  cost: number;           // relative cost (0 = free/local, higher = more expensive)
  throughput: number;     // tokens per second
}

/**
 * Métricas de fallback para providers SEM histórico no RequestLog.
 * Usado APENAS quando não há dados reais disponíveis (provider novo ou primeira chamada).
 * Em produção, estas métricas são substituídas por dados reais do RequestLog.
 */
const fallbackMetrics: Record<string, ProviderMetrics> = {
  // Priority 1: Local First
  'ollama': { priority: 1, health: 0.95, latency: 200, contextWindow: 8192, cost: 0, throughput: 50 },
  'lmstudio': { priority: 1, health: 0.95, latency: 150, contextWindow: 8192, cost: 0, throughput: 60 },
  'comfyui': { priority: 1, health: 0.90, latency: 5000, contextWindow: 0, cost: 0, throughput: 1 },
  'forge': { priority: 1, health: 0.90, latency: 4000, contextWindow: 0, cost: 0, throughput: 1 },
  'a1111': { priority: 1, health: 0.90, latency: 4000, contextWindow: 0, cost: 0, throughput: 1 },
  'sdapi': { priority: 1, health: 0.90, latency: 4000, contextWindow: 0, cost: 0, throughput: 1 },
  // Priority 2: Cloud Second
  'gemini': { priority: 2, health: 0.95, latency: 400, contextWindow: 1048576, cost: 1, throughput: 100 },
  'anthropic': { priority: 2, health: 0.95, latency: 500, contextWindow: 200000, cost: 3, throughput: 80 },
  'openai': { priority: 2, health: 0.95, latency: 450, contextWindow: 128000, cost: 2, throughput: 90 },
  'groq': { priority: 2, health: 0.95, latency: 100, contextWindow: 32768, cost: 0.5, throughput: 800 },
  'cloudflare': { priority: 2, health: 0.95, latency: 150, contextWindow: 8192, cost: 0.1, throughput: 300 },
  // Priority 3: Fallback Third
  'openrouter': { priority: 3, health: 0.90, latency: 800, contextWindow: 128000, cost: 1.5, throughput: 40 },
  'replicate': { priority: 3, health: 0.85, latency: 3000, contextWindow: 8192, cost: 2, throughput: 20 },
  'mission': { priority: 1, health: 0.95, latency: 100, contextWindow: 8192, cost: 0, throughput: 100 },
};

export interface ProviderScoreContext {
  availability: number;
  latency: number;
  cost: number;
  quality: number;
}

export interface RealMetrics {
  health: number;
  latency: number;
  throughput: number;
  errorRate: number;
  callCount: number;
}

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

  private static metricsFetcher: ((providerName: string) => Promise<RealMetrics | null>) | null = null;

  /**
   * Define a função que busca métricas reais do banco de dados.
   * Deve ser configurado pelo backend ao inicializar.
   */
  public static setMetricsFetcher(fetcher: (providerName: string) => Promise<RealMetrics | null>): void {
    ProviderRegistry.metricsFetcher = fetcher;
  }

  /**
   * Busca métricas reais do RequestLog para um provider.
   * Retorna null se não houver dados suficientes (fallback será usado).
   */
  private async getRealMetrics(providerName: string): Promise<RealMetrics | null> {
    const fetcher = ProviderRegistry.metricsFetcher;
    if (!fetcher) return null;
    
    try {
      return await fetcher(providerName);
    } catch {
      return null;
    }
  }

  /**
   * Pipeline Enterprise v2.0:
   * Capability ➔ Priority ➔ Health ➔ Latency ➔ Context Window ➔ Preço ➔ Throughput ➔ Provider
   */
  public async calculateScore(provider: AIProvider, _capability: Capability): Promise<number> {
    // Tenta obter métricas reais primeiro
    const realMetrics = await this.getRealMetrics(provider.name);
    
    let metrics: ProviderMetrics;
    
    if (realMetrics && realMetrics.callCount >= 5) {
      // Usa métricas reais se tiver pelo menos 5 chamadas
      metrics = {
        priority: fallbackMetrics[provider.name]?.priority ?? 3,
        health: realMetrics.health,
        latency: realMetrics.latency,
        contextWindow: fallbackMetrics[provider.name]?.contextWindow ?? 4096,
        cost: fallbackMetrics[provider.name]?.cost ?? 5,
        throughput: realMetrics.throughput,
      };
    } else {
      // Usa fallback para providers novos ou sem histórico
      metrics = fallbackMetrics[provider.name] || {
        priority: 3, // assume fallback
        health: 1.0,
        latency: 1000,
        contextWindow: 4096,
        cost: 5,
        throughput: 10
      };
    }

    // Filtro rígido de health (se menor que 0.5, penaliza absurdamente)
    if (metrics.health < 0.5) return -9999;

    let score = 10000;
    
    // Priority (Local First = 1 -> +3000 pts, Cloud Second = 2 -> +2000 pts)
    score += (4 - metrics.priority) * 1000;

    // Health (0.0 a 1.0) -> até +500 pts
    score += metrics.health * 500;

    // Latency (menor é melhor) -> -1 pt por ms
    score -= metrics.latency;

    // Context Window (maior é melhor) -> +1 pt a cada 10k tokens
    score += (metrics.contextWindow / 10000);

    // Preço (menor é melhor) -> -100 pts por unidade de custo
    score -= (metrics.cost * 100);

    // Throughput (maior é melhor) -> +1 pt por token/s
    score += metrics.throughput;

    return score;
  }

  /**
   * Resolve o provider para uma capacidade baseado em SCORE:
   * provider explicito na requisicao > default configurado > provider com maior SCORE.
   */
  async resolve(capability: Capability, requestedProvider?: string): Promise<AIProvider> {
    if (requestedProvider && requestedProvider.toLowerCase() !== 'auto') {
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
    
    // Scored resolution - agora usa calculateScore assíncrono com métricas reais
    const candidates = this.list().filter((p) => p.capabilities.includes(capability));
    if (candidates.length === 0) {
      throw new ProviderError(
        'registry',
        `no provider registered for capability "${capability}"`,
        'NO_PROVIDER_AVAILABLE',
        503,
      );
    }

    // Calcula scores assíncronos usando métricas reais do RequestLog
    const scoredCandidates = await Promise.all(
      candidates.map(async (provider) => ({
        provider,
        score: await this.calculateScore(provider, capability),
      }))
    );
    
    scoredCandidates.sort((a, b) => b.score - a.score);
    return scoredCandidates[0].provider;
  }

  async resolveCandidates(
    capability: Capability,
    requestedProvider?: string,
    fallbackOrder: string[] = [],
  ): Promise<AIProvider[]> {
    const primary = await this.resolve(capability, requestedProvider);
    const rank = new Map(fallbackOrder.map((name, index) => [name, index]));
    const rest = this.list()
      .filter((p) => p.name !== primary.name && p.capabilities.includes(capability))
      .sort((a, b) => {
        const rankA = rank.get(a.name) ?? Number.MAX_SAFE_INTEGER;
        const rankB = rank.get(b.name) ?? Number.MAX_SAFE_INTEGER;
        if (rankA !== rankB) return rankA - rankB;
        // Fallback to priority-based sorting for sync context
        const priorityA = fallbackMetrics[a.name]?.priority ?? 3;
        const priorityB = fallbackMetrics[b.name]?.priority ?? 3;
        return priorityA - priorityB;
      });
    return [primary, ...rest];
  }
}

export type Env = Record<string, string | undefined>;

/** Constroi o registry a partir das variaveis de ambiente. */
export function createRegistryFromEnv(env: Env): ProviderRegistry {
  const registry = new ProviderRegistry();
  
  registry.register(new MissionProvider(registry));

  if (env.OLLAMA_BASE_URL) {
    registry.register(
      new OllamaProvider({
        baseUrl: env.OLLAMA_BASE_URL,
        defaultModel: env.OLLAMA_DEFAULT_MODEL,
        embedModel: env.OLLAMA_EMBED_MODEL,
        visionModel: env.OLLAMA_VISION_MODEL,
        maxParallel: env.OLLAMA_NUM_PARALLEL ? Number(env.OLLAMA_NUM_PARALLEL) : undefined,
        timeoutMs: env.OLLAMA_TIMEOUT_MS ? Number(env.OLLAMA_TIMEOUT_MS) : undefined,
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
        capabilities: ['chat', 'embedding', 'vision', 'image', 'audio'],
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
        defaultModel: env.CLAUDE_DEFAULT_MODEL ?? 'claude-3-opus-20240229',
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
        capabilities: ['chat', 'vision'],
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
        capabilities: ['chat'],
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
        capabilities: ['chat'],
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
          ? ['chat', 'embedding', 'vision']
          : ['chat', 'vision'],
      }),
    );
  }

  if (env.LMSTUDIO_BASE_URL) {
    registry.register(
      new OpenAICompatibleProvider({
        name: 'lmstudio',
        baseUrl: env.LMSTUDIO_BASE_URL,
        defaultModel: env.LMSTUDIO_DEFAULT_MODEL,
        capabilities: ['chat', 'embedding', 'vision'],
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
        defaultWidth: env.COMFYUI_DEFAULT_WIDTH ? Number(env.COMFYUI_DEFAULT_WIDTH) : undefined,
        defaultHeight: env.COMFYUI_DEFAULT_HEIGHT ? Number(env.COMFYUI_DEFAULT_HEIGHT) : undefined,
        defaultSteps: env.COMFYUI_DEFAULT_STEPS ? Number(env.COMFYUI_DEFAULT_STEPS) : undefined,
        lcmLoraName: env.COMFYUI_LCM_LORA,
        lcmMode: env.COMFYUI_LCM_MODE === 'true',
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
        textModel: env.REPLICATE_TEXT_MODEL, // used for chat in replicate probably
      }),
    );
  }

  const defaults: Array<[Capability, string | undefined]> = [
    ['chat', env.DEFAULT_CHAT_PROVIDER],
    ['image', env.DEFAULT_IMAGE_PROVIDER],
    ['embedding', env.DEFAULT_EMBED_PROVIDER],
    ['vision', env.DEFAULT_VISION_PROVIDER],
    ['audio', env.DEFAULT_AUDIO_PROVIDER],
    ['mission', env.DEFAULT_MISSION_PROVIDER],
  ];
  for (const [capability, name] of defaults) {
    if (name) registry.setDefault(capability, name);
  }

  return registry;
}
