import { createHash } from 'node:crypto';

export interface ExecutionMemoryCandidate {
  provider: string;
  model: string;
  successCount: number;
  failureCount: number;
  approvedCount: number;
  rejectedCount: number;
  qualityTotal: number;
  durationTotalMs: bigint | number;
}

export interface ExecutionMemoryChoice {
  provider: string;
  model: string;
  confidence: number;
  averageQuality: number;
  averageDurationMs: number;
}

function lengthBucket(value: unknown): string {
  const length = typeof value === 'string' ? value.length : 0;
  if (length <= 250) return 'short';
  if (length <= 2_000) return 'medium';
  return 'long';
}

/**
 * Contexto operacional sem guardar prompt, imagem ou dados do cliente.
 * Ele agrupa trabalhos com custo semelhante para aprender a melhor rota.
 */
export function executionMemoryContext(queue: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    queue,
    task: typeof data.task === 'string' ? data.task : queue,
    kind: typeof data.__kind === 'string' ? data.__kind : undefined,
    operation: typeof data.operation === 'string' ? data.operation : undefined,
    inputSize: lengthBucket(data.prompt ?? data.text ?? (Array.isArray(data.messages) ? JSON.stringify(data.messages) : undefined)),
    hasImage: Boolean(data.image) || (Array.isArray(data.images) && data.images.length > 0),
    hasVideo: Boolean(data.video),
    width: typeof data.width === 'number' ? data.width : undefined,
    height: typeof data.height === 'number' ? data.height : undefined,
    batch: typeof data.batch === 'number' ? data.batch : undefined,
    json: data.json === true,
  };
}

export function executionMemoryHash(queue: string, data: Record<string, unknown>): string {
  const context = executionMemoryContext(queue, data);
  const stable = Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

/** Escolhe somente rotas com evidência suficiente e baixa rejeição explícita. */
export function chooseExecutionMemory(candidates: ExecutionMemoryCandidate[]): ExecutionMemoryChoice | undefined {
  const ranked = candidates
    .filter((item) => item.successCount >= 3)
    .map((item) => {
      const attempts = item.successCount + item.failureCount;
      const feedback = item.approvedCount + item.rejectedCount;
      const reliability = item.successCount / Math.max(1, attempts);
      const approval = feedback ? item.approvedCount / feedback : 0.9;
      const averageQuality = item.qualityTotal / Math.max(1, item.successCount);
      const averageDurationMs = Number(item.durationTotalMs) / Math.max(1, item.successCount);
      const confidence = reliability * approval * Math.min(1, item.successCount / 10);
      const score = confidence * averageQuality - Math.log10(Math.max(10, averageDurationMs)) * 5;
      return { ...item, confidence, averageQuality, averageDurationMs, score };
    })
    .filter((item) => item.confidence >= 0.45 && item.averageQuality >= 90)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return undefined;
  return {
    provider: best.provider,
    model: best.model,
    confidence: Number(best.confidence.toFixed(3)),
    averageQuality: Number(best.averageQuality.toFixed(2)),
    averageDurationMs: Math.round(best.averageDurationMs),
  };
}
