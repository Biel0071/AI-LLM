export type Capability = 'text' | 'chat' | 'image' | 'upscale' | 'embed' | 'vision';

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
  upscale(input: UpscaleInput): Promise<ProviderResult<{ images: GeneratedImage[] }>>;
  embed(input: EmbedInput): Promise<ProviderResult<{ embeddings: number[][] }>>;
  vision(input: VisionInput): Promise<ProviderResult<{ text: string }>>;
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
    details?: unknown;
  };
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly code: string = 'PROVIDER_ERROR',
    public readonly statusCode: number = 502,
  ) {
    super(`[${provider}] ${message}`);
    this.name = 'ProviderError';
  }
}

export class CapabilityNotSupportedError extends ProviderError {
  constructor(provider: string, capability: Capability) {
    super(provider, `capability "${capability}" is not supported`, 'CAPABILITY_NOT_SUPPORTED', 400);
    this.name = 'CapabilityNotSupportedError';
  }
}
