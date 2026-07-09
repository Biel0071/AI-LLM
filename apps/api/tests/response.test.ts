import { describe, expect, it } from 'vitest';
import { fail, ok } from '@ai-platform/shared';

describe('envelope padrao', () => {
  it('resposta de sucesso segue o contrato', () => {
    const res = ok({
      provider: 'ollama',
      model: 'llama3',
      executionTime: 1234.6,
      tokens: { prompt: 10, completion: 20, total: 30 },
      result: { text: 'ola' },
    });
    expect(res).toEqual({
      success: true,
      provider: 'ollama',
      model: 'llama3',
      executionTime: 1235,
      tokens: { prompt: 10, completion: 20, total: 30 },
      cached: false,
      result: { text: 'ola' },
    });
  });

  it('tokens vazios viram objeto vazio', () => {
    const res = ok({ provider: 'x', model: 'y', executionTime: 0, result: null });
    expect(res.tokens).toEqual({});
  });

  it('erro segue o contrato', () => {
    const err = fail('VALIDATION_ERROR', 'payload invalido');
    expect(err.success).toBe(false);
    expect(err.error.code).toBe('VALIDATION_ERROR');
  });
});
