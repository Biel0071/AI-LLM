export interface SystemConfig {
  version: string;
  updatedAt: string;
  gateway: {
    port: number;
    corsEnabled: boolean;
    rateLimitPerMin: number;
  };
  providers: {
    groq: { apiKey: string; enabled: boolean; priority: number };
    openrouter: { apiKey: string; enabled: boolean; priority: number };
    ollama: { baseUrl: string; enabled: boolean; priority: number };
    comfyui: { baseUrl: string; enabled: boolean; priority: number };
    whisper: { baseUrl: string; enabled: boolean; priority: number };
  };
  routing: {
    fallbackStrategy: 'latency-cost' | 'priority' | 'round-robin';
    maxRetries: number;
    circuitBreakerTimeoutMs: number;
  };
  security: {
    jwtSecret: string;
    requireApiKey: boolean;
    allowedOrigins: string[];
  };
}

export class ConfigurationCenterService {
  private config: SystemConfig;

  constructor() {
    this.config = {
      version: '2.0.0',
      updatedAt: new Date().toISOString(),
      gateway: {
        port: Number(process.env.PORT || 3000),
        corsEnabled: true,
        rateLimitPerMin: 120,
      },
      providers: {
        groq: { apiKey: process.env.GROQ_API_KEY || '', enabled: true, priority: 1 },
        openrouter: { apiKey: process.env.OPENROUTER_API_KEY || '', enabled: true, priority: 2 },
        ollama: { baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434', enabled: true, priority: 3 },
        comfyui: { baseUrl: process.env.COMFYUI_BASE_URL || 'http://localhost:8188', enabled: true, priority: 4 },
        whisper: { baseUrl: process.env.WHISPER_BASE_URL || 'http://localhost:9000', enabled: true, priority: 5 },
      },
      routing: {
        fallbackStrategy: 'latency-cost',
        maxRetries: 3,
        circuitBreakerTimeoutMs: 5000,
      },
      security: {
        jwtSecret: process.env.JWT_SECRET || 'api-platform-secret-key',
        requireApiKey: true,
        allowedOrigins: ['*'],
      },
    };
  }

  public getConfig(): SystemConfig {
    return { ...this.config };
  }

  public updateConfig(partial: Partial<SystemConfig>): SystemConfig {
    this.config = {
      ...this.config,
      ...partial,
      updatedAt: new Date().toISOString(),
    };
    return this.getConfig();
  }

  public updateProvider(providerId: keyof SystemConfig['providers'], settings: any): SystemConfig {
    if (this.config.providers[providerId]) {
      this.config.providers[providerId] = {
        ...this.config.providers[providerId],
        ...settings,
      };
      this.config.updatedAt = new Date().toISOString();
    }
    return this.getConfig();
  }
}
