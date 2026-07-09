import { describe, expect, it } from 'vitest';
import { cacheKey, canonicalStringify, hashApiKey, sha256 } from '@ai-platform/shared';

describe('canonicalStringify', () => {
  it('ordena chaves de forma deterministica', () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe(canonicalStringify({ a: 2, b: 1 }));
  });

  it('ignora valores undefined', () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe(canonicalStringify({ a: 1 }));
  });

  it('serializa arrays e objetos aninhados', () => {
    expect(canonicalStringify({ a: [{ y: 1, x: 2 }] })).toBe('{"a":[{"x":2,"y":1}]}');
  });
});

describe('cacheKey', () => {
  it('mesmo prompt => mesma chave (nunca chama a IA novamente)', () => {
    const a = cacheKey('text', 'ollama', 'llama3', { prompt: 'ola', maxTokens: 100 });
    const b = cacheKey('text', 'ollama', 'llama3', { maxTokens: 100, prompt: 'ola' });
    expect(a).toBe(b);
  });

  it('prompt diferente => chave diferente', () => {
    const a = cacheKey('text', 'ollama', 'llama3', { prompt: 'ola' });
    const b = cacheKey('text', 'ollama', 'llama3', { prompt: 'oi' });
    expect(a).not.toBe(b);
  });

  it('modelo/provider diferentes => chaves diferentes', () => {
    const base = cacheKey('text', 'ollama', 'llama3', { prompt: 'x' });
    expect(cacheKey('text', 'ollama', 'qwen3', { prompt: 'x' })).not.toBe(base);
    expect(cacheKey('text', 'openai', 'llama3', { prompt: 'x' })).not.toBe(base);
  });
});

describe('hashes', () => {
  it('sha256 e hashApiKey sao estaveis', () => {
    expect(sha256('abc')).toHaveLength(64);
    expect(hashApiKey('ap_test')).toBe(hashApiKey('ap_test'));
  });
});
