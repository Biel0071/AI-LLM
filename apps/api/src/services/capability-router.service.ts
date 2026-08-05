import { execute, registry } from './ai.service';
import { listProviderConfigs } from './provider-config.service';

export interface CapabilityRequest {
  capability: 'text' | 'image' | 'audio' | 'speech' | 'vision' | 'embedding' | 'reasoning' | 'tool-calling';
  prompt?: string;
  messages?: any[];
  model?: string;
  tenantId?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface CapabilityMatch {
  providerId: string;
  model: string;
  qualityScore: number;
  estimatedLatencyMs: number;
  estimatedCost: number;
}

export class CapabilityRouterService {
  private fallbackChain: Map<string, string[]> = new Map();

  constructor() {
    this.initDefaultFallbackChains();
  }

  private initDefaultFallbackChains() {
    this.fallbackChain.set('text', ['groq', 'openrouter', 'ollama']);
    this.fallbackChain.set('image', ['comfyui', 'openrouter']);
    this.fallbackChain.set('speech', ['whisper', 'groq']);
    this.fallbackChain.set('embedding', ['ollama', 'openai']);
    this.fallbackChain.set('reasoning', ['groq', 'openrouter', 'ollama']);
  }

  public getFallbackChain(capability: string): string[] {
    return this.fallbackChain.get(capability) || ['groq', 'openrouter', 'ollama'];
  }

  public setFallbackChain(capability: string, providers: string[]): void {
    this.fallbackChain.set(capability, providers);
  }

  public async resolveBestProvider(req: CapabilityRequest): Promise<CapabilityMatch> {
    const chain = this.getFallbackChain(req.capability);

    for (const providerId of chain) {
      const isHealthy = await this.checkProviderHealth(providerId);
      if (isHealthy) {
        return {
          providerId,
          model: req.model || this.getDefaultModelForProvider(providerId, req.capability),
          qualityScore: 0.95,
          estimatedLatencyMs: providerId === 'groq' ? 120 : providerId === 'ollama' ? 300 : 450,
          estimatedCost: providerId === 'ollama' ? 0.0 : 0.0002
        };
      }
    }

    return {
      providerId: 'ollama',
      model: req.model || 'llama3:latest',
      qualityScore: 0.85,
      estimatedLatencyMs: 500,
      estimatedCost: 0.0
    };
  }

  private async checkProviderHealth(providerId: string): Promise<boolean> {
    try {
      const configs = await listProviderConfigs();
      const config = configs.find((c: any) => c.name === providerId);
      return config ? config.enabled : true;
    } catch {
      return true;
    }
  }

  private getDefaultModelForProvider(providerId: string, capability: string): string {
    if (providerId === 'groq') return 'llama-3.3-70b-versatile';
    if (providerId === 'openrouter') return 'meta-llama/llama-3.1-70b-instruct';
    if (providerId === 'ollama') return 'llama3:latest';
    if (providerId === 'comfyui') return 'sdxl_turbo';
    if (providerId === 'whisper') return 'whisper-large-v3';
    return 'default';
  }

  public async executeCapability(req: CapabilityRequest): Promise<any> {
    const match = await this.resolveBestProvider(req);
    const promptText = req.prompt || (req.messages && req.messages.length > 0 ? req.messages[req.messages.length - 1].content : 'Hello');

    try {
      const res = await execute(
        'chat',
        { prompt: promptText, provider: match.providerId, model: match.model },
        async (provider) => provider.generateText({ prompt: promptText, model: match.model }),
        { tenantId: req.tenantId }
      );
      return {
        text: (res.result as any)?.text || promptText,
        resolvedProvider: match.providerId,
        resolvedModel: match.model
      };
    } catch {
      return {
        text: `[Fallback Response] Processado via ${match.providerId}`,
        resolvedProvider: match.providerId,
        resolvedModel: match.model
      };
    }
  }
}

