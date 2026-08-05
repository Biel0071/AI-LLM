import { ModelInfo } from './types';

export const ModelTraits: Record<string, Partial<ModelInfo>> = {
  'llama-3.1-8b-instant': {
    maxContextTokens: 12000,
    strengths: ['chat'],
    tier: 'cheap',
  },
  'llama-3.3-70b-versatile': {
    maxContextTokens: 12000,
    strengths: ['chat', 'code'],
    tier: 'medium',
  },
  'gemini-2.0-flash': {
    maxContextTokens: 1000000,
    strengths: ['chat', 'code', 'vision'],
    tier: 'strong',
  },
  'gemini-1.5-flash': {
    maxContextTokens: 1000000,
    strengths: ['chat', 'code', 'vision'],
    tier: 'strong',
  },
  'claude-3-5-sonnet-20241022': {
    maxContextTokens: 200000,
    strengths: ['chat', 'code', 'vision'],
    tier: 'strong',
  },
  'claude-3-haiku-20240307': {
    maxContextTokens: 200000,
    strengths: ['chat', 'vision'],
    tier: 'medium',
  },
  'claude-3-opus-20240229': {
    maxContextTokens: 200000,
    strengths: ['chat', 'code', 'vision'],
    tier: 'strong',
  },
  'qwen2.5:3b': {
    maxContextTokens: parseInt(process.env.OLLAMA_MAX_CONTEXT || '8192', 10),
    strengths: ['chat'],
    tier: 'cheap',
  },
  'qwen2.5-coder:7b': {
    maxContextTokens: parseInt(process.env.OLLAMA_MAX_CONTEXT || '8192', 10),
    strengths: ['chat', 'code'],
    tier: 'cheap',
  },
  'gpt-4o-mini': {
    maxContextTokens: 128000,
    strengths: ['chat', 'vision'],
    tier: 'medium',
  },
  'gpt-4o': {
    maxContextTokens: 128000,
    strengths: ['chat', 'code', 'vision'],
    tier: 'strong',
  },
};

export function getModelTraits(modelId: string): Partial<ModelInfo> {
  // Busca exata
  if (ModelTraits[modelId]) return ModelTraits[modelId];

  // Buscas parciais (heuristica)
  if (modelId.includes('sonnet')) return ModelTraits['claude-3-5-sonnet-20241022'];
  if (modelId.includes('haiku')) return ModelTraits['claude-3-haiku-20240307'];
  if (modelId.includes('opus')) return ModelTraits['claude-3-opus-20240229'];
  if (modelId.includes('gpt-4o-mini')) return ModelTraits['gpt-4o-mini'];
  if (modelId.includes('gpt-4o')) return ModelTraits['gpt-4o'];
  if (modelId.includes('gemini-2.0-flash')) return ModelTraits['gemini-2.0-flash'];
  if (modelId.includes('gemini-1.5-flash')) return ModelTraits['gemini-1.5-flash'];
  if (modelId.includes('llama-3.3-70b')) return ModelTraits['llama-3.3-70b-versatile'];
  if (modelId.includes('llama-3.1-8b')) return ModelTraits['llama-3.1-8b-instant'];
  if (modelId.includes('qwen2.5:3b')) return ModelTraits['qwen2.5:3b'];
  if (modelId.includes('qwen')) return ModelTraits['qwen2.5:3b'];

  // Default fallback
  return {
    maxContextTokens: 8192,
    strengths: ['chat'],
    tier: 'cheap',
  };
}
