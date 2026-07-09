import { createHash } from 'node:crypto';

/** Serializacao canonica (chaves ordenadas) para hash deterministico */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>)
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Chave de cache do prompt: mesmo prompt + provider + modelo + parametros
 * => mesma chave => nunca chama a IA novamente.
 */
export function cacheKey(capability: string, provider: string, model: string, input: unknown): string {
  return sha256(canonicalStringify({ capability, provider, model, input }));
}

export function hashApiKey(key: string): string {
  return sha256(key);
}
