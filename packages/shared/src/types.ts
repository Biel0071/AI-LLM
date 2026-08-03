export type Capability = 'chat' | 'vision' | 'image' | 'embedding' | 'audio' | 'mission';

export interface CapabilityDefinition {
  id: Capability;
  version: string;
  providerTypes: string[];
  requiredTools?: string[];
  supportsStreaming: boolean;
  supportsAsync: boolean;
  supportsRetry: boolean;
  supportsFallback: boolean;
}

export const CapabilityRegistry: Record<Capability, CapabilityDefinition> = {
  chat: { id: 'chat', version: '1.0', providerTypes: ['llm'], supportsStreaming: true, supportsAsync: false, supportsRetry: true, supportsFallback: true },
  vision: { id: 'vision', version: '1.0', providerTypes: ['vlm'], supportsStreaming: true, supportsAsync: false, supportsRetry: true, supportsFallback: true },
  image: { id: 'image', version: '1.0', providerTypes: ['diffusion'], supportsStreaming: false, supportsAsync: true, supportsRetry: true, supportsFallback: true },
  embedding: { id: 'embedding', version: '1.0', providerTypes: ['embedding'], supportsStreaming: false, supportsAsync: false, supportsRetry: true, supportsFallback: true },
  audio: { id: 'audio', version: '1.0', providerTypes: ['audio'], supportsStreaming: true, supportsAsync: false, supportsRetry: true, supportsFallback: true },
  mission: { id: 'mission', version: '1.0', providerTypes: ['llm'], requiredTools: ['planner', 'memory'], supportsStreaming: true, supportsAsync: true, supportsRetry: true, supportsFallback: true },
};

export interface TokenUsage {
  prompt?: number;
  completion?: number;
  total?: number;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Base64 (sem prefixo data:) ou URLs de imagens para mensagens multimodais */
  images?: string[];
}

export interface GenerateTextInput {
  prompt: string;
  system?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export interface ChatInput {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface GenerateImageInput {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  cfgScale?: number;
  seed?: number;
  model?: string;
  /** Imagem de entrada (base64) para img2img */
  image?: string;
  /** Forca do img2img (0..1) */
  denoise?: number;
  batch?: number;
  removeBackground?: boolean;
}

export interface UpscaleInput {
  /** Imagem base64 ou URL */
  image: string;
  scale?: number;
  model?: string;
}

export interface EmbedInput {
  input: string | string[];
  model?: string;
}

export interface VisionInput {
  prompt: string;
  /** Base64 (com ou sem prefixo data:) ou URLs */
  images: string[];
  model?: string;
  maxTokens?: number;
  stream?: boolean;
}

export interface AudioInput {
  /** Base64 (com ou sem prefixo data:) ou URL do audio para STT, ou texto para TTS */
  data: string;
  type: 'stt' | 'tts';
  model?: string;
  language?: string;
  stream?: boolean;
}

export interface MissionInput {
  objective: string;
  context?: string;
  tools?: string[];
  model?: string;
  stream?: boolean;
  async?: boolean;
}

export interface GeneratedImage {
  base64?: string;
  url?: string;
  seed?: number;
  mimeType?: string;
}

export interface ProviderResult<T> {
  result: T;
  model: string;
  tokens?: TokenUsage;
  raw?: unknown;
}

export interface ModelInfo {
  id: string;
  name?: string;
  capabilities?: Capability[];
  sizeBytes?: number;
  contextWindow?: number;
}

export interface ProviderHealth {
  online: boolean;
  latency?: number;
  models?: string[];
  requests?: number;
  errors?: number;
}

export interface HealthStatus {
  ok: boolean;
  latencyMs?: number;
  message?: string;
  modelCount?: number;
}

export interface AIProvider {
  readonly name: string;
  readonly capabilities: Capability[];
  generateText(input: GenerateTextInput): Promise<ProviderResult<{ text: string }>>;
  chat(input: ChatInput): Promise<ProviderResult<{ message: ChatMessage }>>;
  generateImage(input: GenerateImageInput): Promise<ProviderResult<{ images: GeneratedImage[] }>>;
  embed(input: EmbedInput): Promise<ProviderResult<{ embeddings: number[][] }>>;
  vision(input: VisionInput): Promise<ProviderResult<{ text: string }>>;
  audio(input: AudioInput): Promise<ProviderResult<{ text?: string; audio?: string; language?: string; confidence?: number; metadata?: unknown }>>;
  mission?(input: MissionInput): Promise<ProviderResult<unknown>>;
  health(): Promise<HealthStatus>;
  models(): Promise<ModelInfo[]>;
}

/** Envelope padrao de TODAS as respostas da plataforma */
export interface StandardResponse<T = unknown> {
  success: boolean;
  provider: string;
  model: string;
  executionTime: number;
  tokens: TokenUsage | Record<string, never>;
  cached: boolean;
  result: T;
  quality?: {
    score: number;
    threshold: number;
    passed: boolean;
    method: 'deterministic';
    issues: string[];
  };
}

export interface StandardError {
  success: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    provider?: string;
    traceId?: string;
    details?: unknown;
  };
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly code: string = 'PROVIDER_ERROR',
    public readonly statusCode: number = 502,
    public readonly retryable: boolean = true,
    public readonly traceId?: string
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}

export class CapabilityNotSupportedError extends ProviderError {
  constructor(provider: string, capability: Capability) {
    super(provider, `capability "${capability}" is not supported`, 'CAPABILITY_NOT_SUPPORTED', 400, false);
    this.name = 'CapabilityNotSupportedError';
  }
}
