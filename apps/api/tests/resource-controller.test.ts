import { describe, expect, it } from 'vitest';
import { decideConcurrency, parseProcMeminfo } from '@ai-platform/shared';

describe('adaptive resource controller', () => {
  it('reads host memory and swap from procfs', () => {
    const parsed = parseProcMeminfo('MemTotal: 6000000 kB\nMemAvailable: 1200000 kB\nSwapTotal: 4000000 kB\nSwapFree: 40000 kB\n');
    expect(parsed).toMatchObject({
      memoryTotalBytes: 6000000 * 1024,
      memoryAvailableBytes: 1200000 * 1024,
      swapFreeBytes: 40000 * 1024,
    });
  });

  it('serializes work immediately when swap is exhausted', () => {
    const decision = decideConcurrency({
      memoryTotalBytes: 6_000, memoryAvailableBytes: 1_200,
      swapTotalBytes: 4_000, swapFreeBytes: 20, cpuLoadRatio: 0.4,
    }, 4);
    expect(decision).toMatchObject({ concurrency: 1, pressure: 'critical' });
    expect(decision.reasons).toContain('swap_critical');
  });

  it('restores maximum concurrency only under healthy resources', () => {
    const decision = decideConcurrency({
      memoryTotalBytes: 6_000, memoryAvailableBytes: 3_000,
      swapTotalBytes: 4_000, swapFreeBytes: 3_000, cpuLoadRatio: 0.2,
    }, 4);
    expect(decision).toMatchObject({ concurrency: 4, pressure: 'normal' });
  });
});