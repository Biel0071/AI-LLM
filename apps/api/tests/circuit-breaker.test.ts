import { describe, expect, it } from 'vitest';
import { ProviderCircuitBreaker } from '@ai-platform/shared';

describe('ProviderCircuitBreaker', () => {
  it('abre somente depois do limite de falhas', () => {
    let now = 1_000;
    const circuit = new ProviderCircuitBreaker(2, 30_000, 300_000, () => now);
    circuit.recordFailure('ollama:text');
    expect(circuit.isOpen('ollama:text')).toBe(false);
    circuit.recordFailure('ollama:text');
    expect(circuit.isOpen('ollama:text')).toBe(true);
    now += 30_001;
    expect(circuit.isOpen('ollama:text')).toBe(false);
  });

  it('sucesso limpa o historico de falhas', () => {
    const circuit = new ProviderCircuitBreaker(1, 30_000);
    circuit.recordFailure('comfyui:image');
    circuit.recordSuccess('comfyui:image');
    expect(circuit.isOpen('comfyui:image')).toBe(false);
    expect(circuit.state('comfyui:image')).toBeUndefined();
  });

  it('aumenta cooldown sem ultrapassar o teto', () => {
    const circuit = new ProviderCircuitBreaker(1, 10, 20, () => 100);
    expect(circuit.recordFailure('x').openUntil).toBe(110);
    expect(circuit.recordFailure('x').openUntil).toBe(120);
    expect(circuit.recordFailure('x').openUntil).toBe(120);
  });
});