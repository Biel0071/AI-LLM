import { describe, expect, it } from 'vitest';
import { deterministicTextQuality, resolveAllowedCategory } from '@ai-platform/shared';

describe('quality gate', () => {
  it('rejects unresolved placeholders even when JSON is syntactically valid', () => {
    const report = deterministicTextQuality('{"name":"...","confidence":"0-100"}', 90, { jsonExpected: true });
    expect(report.passed).toBe(false);
    expect(report.score).toBeLessThan(90);
  });

  it('accepts a complete structured response', () => {
    const report = deterministicTextQuality('{"name":"Blusa Ayla Cobre","confidence":96}', 90, { jsonExpected: true });
    expect(report).toMatchObject({ score: 100, passed: true });
  });

  it('normalizes an allowed category without accepting a synonym', () => {
    const categories = ['moda', 'eletronicos'];
    expect(resolveAllowedCategory('Eletrônicos.', categories)).toBe('eletronicos');
    expect(resolveAllowedCategory('Eletrodomésticos', categories)).toBeUndefined();
  });
});