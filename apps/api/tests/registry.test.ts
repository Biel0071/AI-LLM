import { describe, expect, it } from 'vitest';
import { createRegistryFromEnv, ProviderRegistry, OllamaProvider } from '@api-platform/shared';

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

  it('resolve por capacidade respeitando o default', async () => {
    const registry = createRegistryFromEnv({
      OLLAMA_BASE_URL: 'http://localhost:11434',
      OPENAI_API_KEY: 'sk-test',
      DEFAULT_CHAT_PROVIDER: 'openai',
    });
    expect((await registry.resolve('chat')).name).toBe('openai');
    expect((await registry.resolve('chat', 'ollama')).name).toBe('ollama');
  });

  it('trata provider auto como roteamento automatico', async () => {
    const registry = createRegistryFromEnv({
      OLLAMA_BASE_URL: 'http://localhost:11434',
      COMFYUI_BASE_URL: 'http://localhost:8188',
    });
    expect((await registry.resolve('chat', 'auto')).name).toBe('ollama');
    expect((await registry.resolve('image', 'AUTO')).name).toBe('comfyui');
  });

  it('cai no primeiro provider compativel quando nao ha default', async () => {
    const registry = new ProviderRegistry();
    registry.register(new OllamaProvider({ baseUrl: 'http://x' }));
    expect((await registry.resolve('chat')).name).toBe('ollama');
  });

  it('erro claro quando provider nao suporta a capacidade', async () => {
    const registry = createRegistryFromEnv({ COMFYUI_BASE_URL: 'http://localhost:8188' });
    await expect(async () => await registry.resolve('text', 'comfyui')).rejects.toThrow(/does not support/);
  });

  it('erro claro quando nenhum provider atende a capacidade', async () => {
    const registry = new ProviderRegistry();
    await expect(registry.resolve('image')).rejects.toThrow(/no provider registered/);
  });
});
