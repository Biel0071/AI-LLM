import { describe, expect, it } from 'vitest';
import { createRegistryFromEnv, ProviderRegistry, OllamaProvider } from '@ai-platform/shared';

describe('ProviderRegistry', () => {
  it('registra providers a partir do ambiente', () => {
    const registry = createRegistryFromEnv({
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OPENAI_API_KEY: 'sk-test',
      COMFYUI_BASE_URL: 'http://localhost:8188',
    });
    expect(registry.has('ollama')).toBe(true);
    expect(registry.has('openai')).toBe(true);
    expect(registry.has('comfyui')).toBe(true);
    expect(registry.has('claude')).toBe(false); // sem ANTHROPIC_API_KEY
  });

  it('resolve por capacidade respeitando o default', () => {
    const registry = createRegistryFromEnv({
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OPENAI_API_KEY: 'sk-test',
      DEFAULT_TEXT_PROVIDER: 'openai',
    });
    expect(registry.resolve('text').name).toBe('openai');
    expect(registry.resolve('text', 'ollama').name).toBe('ollama');
  });

  it('cai no primeiro provider compativel quando nao ha default', () => {
    const registry = new ProviderRegistry();
    registry.register(new OllamaProvider({ baseUrl: 'http://x' }));
    expect(registry.resolve('chat').name).toBe('ollama');
  });

  it('erro claro quando provider nao suporta a capacidade', () => {
    const registry = createRegistryFromEnv({ COMFYUI_BASE_URL: 'http://localhost:8188' });
    expect(() => registry.resolve('text', 'comfyui')).toThrow(/does not support/);
  });

  it('erro claro quando nenhum provider atende a capacidade', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.resolve('image')).toThrow(/no provider registered/);
  });
});
