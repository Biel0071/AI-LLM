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
import { globalGpuSemaphore } from '../gpu-semaphore';

export interface OllamaConfig {
  baseUrl: string;
  defaultModel?: string;
  embedModel?: string;
  visionModel?: string;
  maxParallel?: number;
}

/**
 * Limita quantas chamadas simultaneas saem para o Ollama a partir deste
 * processo. Sem isso, um lote do Lovable disparando 10-12 requests ao mesmo
 * tempo abre 10-12 conexoes simultaneas via host.docker.internal — o proxy
 * de rede do Docker Desktop no Windows engasga sob esse volume de conexoes
 * concorrentes e derruba algumas por volta de ~45s (mesmo com timeoutMs
 * configurado bem mais alto). Uma unica requisicao lenta (sem concorrencia)
 * roda tranquila por 190s+ pelo mesmo caminho — o problema e concorrencia de
 * conexoes, nao o tempo em si. Enfileirando aqui dentro do processo (barato,
 * em memoria) em vez de deixar todas baterem na rede ao mesmo tempo, evita o
 * gargalo. O limite acompanha OLLAMA_NUM_PARALLEL (mesma capacidade real que
 * o Ollama processa em paralelo).
 */
class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  constructor(private readonly max: number) {}
  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }
  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

/**
 * Provider nativo do Ollama (endpoints /api/*).
 * Compativel com Gemma, Llama3, Qwen, Mistral, DeepSeek, Phi e qualquer
 * modelo instalado — a lista e obtida dinamicamente via /api/tags e o
 * modelo pode ser trocado por requisicao (campo "model").
 */
export class OllamaProvider extends BaseProvider {
  readonly name = 'ollama';
  readonly capabilities: Capability[] = ['text', 'chat', 'embed', 'vision'];
  private readonly semaphore: Semaphore;

  constructor(private readonly config: OllamaConfig) {
    super();
    this.semaphore = new Semaphore(config.maxParallel && config.maxParallel > 0 ? config.maxParallel : 3);
  }

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
  }

  private mapUsage(data: any): TokenUsage | undefined {
    if (data?.prompt_eval_count === undefined && data?.eval_count === undefined) return undefined;
    const prompt = data?.prompt_eval_count ?? 0;
    const completion = data?.eval_count ?? 0;
    return { prompt, completion, total: prompt + completion };
  }

  private requireModel(model?: string, fallback?: string): string {
    const resolved = model ?? fallback ?? this.config.defaultModel;
    if (!resolved) throw new ProviderError(this.name, 'no model configured', 'MODEL_REQUIRED', 400);
    return resolved;
  }

  override async generateText(input: GenerateTextInput): Promise<ProviderResult<{ text: string }>> {
    const model = this.requireModel(input.model);
    const release = await this.semaphore.acquire();
    const releaseGpu = await globalGpuSemaphore.acquire();
    let data: any;
    try {
      data = await this.http<any>(this.url('/api/generate'), {
        method: 'POST',
        body: {
          model,
          prompt: input.prompt,
          system: input.system,
          stream: false,
          format: input.json ? 'json' : undefined,
          options: {
            temperature: input.temperature,
            num_predict: input.maxTokens,
          },
        },
        // Cloudflare mata qualquer request proxiado com HTTP 524 em ~100s,
        // mesmo atras de tunel - nao ha como aumentar isso do nosso lado.
        // Deixar o Ollama tentar por 300s so cria "zumbis": o cliente ja
        // desistiu e recebeu 524, mas a geracao continua rodando aqui dentro
        // e segurando uma das 3 vagas do semaforo por ate 5 minutos. Sob
        // retry automatico (como o do Lovable), isso empilha zumbis mais
        // rapido do que eles liberam vaga, entupindo o sistema de vez.
        // 90s garante que um pedido abandonado libera a vaga antes do
        // proximo retry chegar.
        timeoutMs: 90_000,
      });
    } finally {
      releaseGpu();
      release();
    }
    return { result: { text: data?.response ?? '' }, model, tokens: this.mapUsage(data), raw: data };
  }

  override async chat(input: ChatInput): Promise<ProviderResult<{ message: ChatMessage }>> {
    const model = this.requireModel(input.model);
    const messages = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
      images: m.images?.map((img) => parseImageInput(img).data),
    }));
    const release = await this.semaphore.acquire();
    const releaseGpu = await globalGpuSemaphore.acquire();
    let data: any;
    try {
      data = await this.http<any>(this.url('/api/chat'), {
        method: 'POST',
        body: {
          model,
          messages,
          stream: false,
          options: { temperature: input.temperature, num_predict: input.maxTokens },
        },
        timeoutMs: 90_000,
      });
    } finally {
      releaseGpu();
      release();
    }
    return {
      result: { message: { role: 'assistant', content: data?.message?.content ?? '' } },
      model,
      tokens: this.mapUsage(data),
      raw: data,
    };
  }

  override async vision(input: VisionInput): Promise<ProviderResult<{ text: string }>> {
    const model = this.requireModel(input.model, this.config.visionModel);
    const res = await this.chat({
      messages: [{ role: 'user', content: input.prompt, images: input.images }],
      model,
      maxTokens: input.maxTokens,
    });
    return { result: { text: res.result.message.content }, model: res.model, tokens: res.tokens, raw: res.raw };
  }

  override async embed(input: EmbedInput): Promise<ProviderResult<{ embeddings: number[][] }>> {
    const model = this.requireModel(input.model, this.config.embedModel);
    const release = await this.semaphore.acquire();
    const releaseGpu = await globalGpuSemaphore.acquire();
    let data: any;
    try {
      data = await this.http<any>(this.url('/api/embed'), {
        method: 'POST',
        body: { model, input: input.input },
      });
    } finally {
      releaseGpu();
      release();
    }
    return { result: { embeddings: data?.embeddings ?? [] }, model, raw: data };
  }

  async models(): Promise<ModelInfo[]> {
    const data = await this.http<any>(this.url('/api/tags'), { timeoutMs: 10_000 });
    return (data?.models ?? []).map((m: any) => ({
      id: m.name,
      name: m.name,
      sizeBytes: m.size,
    }));
  }
}
