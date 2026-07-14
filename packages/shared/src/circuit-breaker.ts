export interface ProviderCircuitState {
  failures: number;
  openUntil: number;
}

/**
 * Circuit breaker local por processo. Evita repetir chamadas caras para um
 * provider que acabou de falhar; ao expirar, uma chamada de prova e permitida.
 */
export class ProviderCircuitBreaker {
  private readonly states = new Map<string, ProviderCircuitState>();

  constructor(
    private readonly threshold = 2,
    private readonly baseCooldownMs = 30_000,
    private readonly maxCooldownMs = 5 * 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  isOpen(key: string): boolean {
    return (this.states.get(key)?.openUntil ?? 0) > this.now();
  }

  recordSuccess(key: string): void {
    this.states.delete(key);
  }

  recordFailure(key: string): ProviderCircuitState {
    const previous = this.states.get(key);
    const failures = (previous?.failures ?? 0) + 1;
    const exponent = Math.max(0, failures - this.threshold);
    const cooldown = failures >= this.threshold
      ? Math.min(this.maxCooldownMs, this.baseCooldownMs * (2 ** exponent))
      : 0;
    const state = { failures, openUntil: cooldown ? this.now() + cooldown : 0 };
    this.states.set(key, state);
    return state;
  }

  state(key: string): ProviderCircuitState | undefined {
    const value = this.states.get(key);
    return value ? { ...value } : undefined;
  }
}