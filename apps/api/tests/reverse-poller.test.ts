import { describe, expect, it } from 'vitest';
import { isPrivateAddress, reverseSourceResponseSchema } from '@ai-platform/shared';

describe('reverse population protocol', () => {
  it('accepts bounded jobs with source ids', () => {
    const response = reverseSourceResponseSchema.parse({
      cursor: 'page-2',
      hasMore: true,
      jobs: [{ sourceJobId: 'product-1', type: 'seo', payload: { product: 'Tênis' } }],
    });
    expect(response.jobs).toHaveLength(1);
    expect(response.hasMore).toBe(true);
  });

  it('rejects recursive job types', () => {
    expect(() => reverseSourceResponseSchema.parse({
      jobs: [{ sourceJobId: 'loop', type: 'webhook', payload: {} }],
    })).toThrow();
  });

  it('blocks private and loopback callback targets', () => {
    expect(isPrivateAddress('127.0.0.1')).toBe(true);
    expect(isPrivateAddress('10.0.0.1')).toBe(true);
    expect(isPrivateAddress('192.168.1.1')).toBe(true);
    expect(isPrivateAddress('8.8.8.8')).toBe(false);
  });
});
