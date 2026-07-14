import { describe, expect, it } from 'vitest';
import { jobSchema, textSchema } from '@ai-platform/shared';

describe('large workload and reverse callback contracts', () => {
  it('defaults text admission to auto', () => {
    expect(textSchema.parse({ prompt: 'produto' }).execution).toBe('auto');
  });

  it('accepts explicit async execution with a signed callback', () => {
    const parsed = textSchema.parse({
      prompt: 'gerar descricao',
      execution: 'async',
      callback: { url: 'https://example.com/hooks/ai', secret: '1234567890abcdef' },
    });
    expect(parsed.callback?.url).toBe('https://example.com/hooks/ai');
  });

  it('accepts callbacks on generic jobs and rejects weak secrets', () => {
    expect(jobSchema.parse({
      type: 'seo', payload: { product: 'Tenis' },
      callback: { url: 'https://example.com/hooks/ai', secret: '1234567890abcdef' },
    }).callback).toBeDefined();
    expect(() => jobSchema.parse({
      type: 'seo', payload: {}, callback: { url: 'https://example.com', secret: 'short' },
    })).toThrow();
  });
});