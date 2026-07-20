import type { StandardResponse } from './types';

export interface QualityReport {
  score: number;
  threshold: number;
  passed: boolean;
  method: 'deterministic';
  issues: string[];
}

function normalizeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

/**
 * Aceita somente uma categoria realmente presente na lista permitida.
 * A comparação ignora acentos, caixa e pontuação, mas nunca tenta adivinhar
 * sinônimos: uma resposta ambígua deve ser refeita, não gravada como correta.
 */
export function resolveAllowedCategory(raw: string, categories: string[]): string | undefined {
  const normalizedRaw = normalizeLabel(
    raw
      .replace(/^```(?:text)?\s*/i, '')
      .replace(/\s*```$/, '')
      .replace(/^["'`]+|["'`.]+$/g, ''),
  );
  return categories.find((category) => normalizeLabel(category) === normalizedRaw);
}

const PLACEHOLDER_PATTERNS = [
  /"\s*\.\.\.\s*"/,
  /\b(?:todo|tbd|lorem ipsum)\b/i,
  /\b0\s*[-–]\s*100\b/,
  /\{\{\s*[^}]+\s*\}\}/,
  /\[(?:insira|insert|preencha|fill)[^\]]*\]/i,
];

export function deterministicTextQuality(
  text: string,
  threshold = 90,
  options: { jsonExpected?: boolean; shortAnswer?: boolean } = {},
): QualityReport {
  const value = text.trim();
  const issues: string[] = [];
  let score = 100;

  if (!value) {
    issues.push('empty_output');
    score = 0;
  } else if (!options.shortAnswer && value.length < 40) {
    issues.push('output_too_short');
    score -= 25;
  }

  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(value)) {
      issues.push('placeholder_or_unresolved_range');
      score -= 45;
      break;
    }
  }

  if (/(.)\1{20,}/.test(value)) {
    issues.push('degenerate_repetition');
    score -= 35;
  }

  if (options.jsonExpected) {
    try {
      JSON.parse(value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    } catch {
      issues.push('invalid_json');
      score -= 55;
    }
  }

  score = Math.max(0, Math.min(100, score));
  return { score, threshold, passed: score >= threshold, method: 'deterministic', issues };
}

export function attachQuality<T>(response: StandardResponse<T>, quality: QualityReport): StandardResponse<T> {
  return Object.assign(response, { quality });
}

export class QualityGateError extends Error {
  constructor(public readonly report: QualityReport) {
    super(`quality gate rejected output: ${report.score}/${report.threshold} (${report.issues.join(', ') || 'semantic mismatch'})`);
    this.name = 'QualityGateError';
  }
}