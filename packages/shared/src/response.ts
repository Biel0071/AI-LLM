import type { StandardError, StandardResponse, TokenUsage } from './types';

export function ok<T>(params: {
  provider: string;
  model: string;
  executionTime: number;
  tokens?: TokenUsage;
  cached?: boolean;
  result: T;
}): StandardResponse<T> {
  return {
    success: true,
    provider: params.provider,
    model: params.model,
    executionTime: Math.round(params.executionTime),
    tokens: params.tokens ?? {},
    cached: params.cached ?? false,
    result: params.result,
  };
}

export function fail(code: string, message: string, details?: unknown): StandardError {
  return { success: false, error: { code, message, details } };
}
