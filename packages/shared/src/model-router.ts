import type { Capability } from './types';

/**
 * Pista de tarefa opcional que o chamador (rota ou worker) pode informar para
 * ajudar a escolher o melhor modelo automaticamente. Nao confundir com
 * Capability: uma mesma capability (ex. "text") cobre varias tasks distintas
 * com custos/qualidade bem diferentes.
 */
export type TaskHint =
  | 'general'
  | 'chat'
  | 'quality'
  | 'classification'
  | 'translation'
  | 'seo'
  | 'ocr'
  | 'vision'
  | 'embed';

export interface ModelRouteEnv {
  OLLAMA_FAST_MODEL?: string;
  OLLAMA_DEFAULT_MODEL?: string;
  OLLAMA_QUALITY_MODEL?: string;
  OLLAMA_VISION_MODEL?: string;
  OLLAMA_EMBED_MODEL?: string;
  [key: string]: string | undefined;
}

/** Tarefas curtas/estruturadas onde um modelo pequeno e rapido basta. */
const FAST_TASKS = new Set<TaskHint>(['classification', 'translation', 'seo']);

/**
 * Escolhe automaticamente o melhor modelo para a tarefa quando o chamador nao
 * especifica um `model` explicito (`model` do usuario sempre tem prioridade -
 * este roteador so preenche a lacuna). Por enquanto so atua sobre o provider
 * Ollama, onde o operador local controla exatamente quais modelos existem
 * instalados; outros providers continuam usando seu proprio default estatico.
 *
 * Retorna `undefined` quando nao ha regra (o provider cai no seu default de
 * sempre).
 */
export function pickModel(
  capability: Capability,
  task: TaskHint | undefined,
  providerName: string,
  env: ModelRouteEnv,
): string | undefined {
  if (providerName !== 'ollama') return undefined;

  if (capability === 'vision' || task === 'vision' || task === 'ocr') {
    return env.OLLAMA_VISION_MODEL || env.OLLAMA_DEFAULT_MODEL;
  }
  if (capability === 'embed' || task === 'embed') {
    return env.OLLAMA_EMBED_MODEL || env.OLLAMA_DEFAULT_MODEL;
  }
  if (task === 'quality') {
    return env.OLLAMA_QUALITY_MODEL || env.OLLAMA_DEFAULT_MODEL;
  }
  if (task && FAST_TASKS.has(task)) {
    return env.OLLAMA_FAST_MODEL || env.OLLAMA_DEFAULT_MODEL;
  }
  return env.OLLAMA_DEFAULT_MODEL;
}
