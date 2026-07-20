import { describe, expect, it } from 'vitest';
import { chooseExecutionMemory, executionMemoryContext, executionMemoryHash } from '@ai-platform/shared';

describe('execution memory', () => {
  it('does not include customer prompt or image contents in its context', () => {
    const first = executionMemoryContext('image', { prompt: 'segredo A', image: 'base64-A', width: 512, height: 512 });
    const second = executionMemoryContext('image', { prompt: 'segredo B', image: 'base64-B', width: 512, height: 512 });
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).not.toContain('segredo');
    expect(executionMemoryHash('image', { prompt: 'segredo A', image: 'A', width: 512, height: 512 }))
      .toBe(executionMemoryHash('image', { prompt: 'segredo B', image: 'B', width: 512, height: 512 }));
  });

  it('requires repeated success before reusing a route', () => {
    expect(chooseExecutionMemory([{
      provider: 'ollama', model: 'qwen', successCount: 2, failureCount: 0,
      approvedCount: 2, rejectedCount: 0, qualityTotal: 200, durationTotalMs: 2_000,
    }])).toBeUndefined();
  });

  it('prefers a reliable, approved and faster route', () => {
    const choice = chooseExecutionMemory([
      { provider: 'slow', model: 'a', successCount: 10, failureCount: 0, approvedCount: 5, rejectedCount: 0, qualityTotal: 980, durationTotalMs: 100_000 },
      { provider: 'fast', model: 'b', successCount: 10, failureCount: 0, approvedCount: 5, rejectedCount: 0, qualityTotal: 970, durationTotalMs: 20_000 },
    ]);
    expect(choice).toMatchObject({ provider: 'fast', model: 'b' });
  });
});
