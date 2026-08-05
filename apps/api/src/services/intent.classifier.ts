import { ExecutionMode, IntentResult } from '@repo/shared';
import { estimatePayloadTokens } from '@api-platform/shared';

export class FastIntentClassifier {
  /**
   * Classifica a requisição baseada em heurísticas rápidas.
   * Não utiliza LLM, resultando em latência quase nula (< 1ms).
   */
  static classify(messages: any[], options: { tools?: any[] } = {}): IntentResult {
    const hasTools = Array.isArray(options.tools) && options.tools.length > 0;
    
    let hasImages = false;
    let hasFiles = false;
    
    // Verifica conteúdo multimídia nas mensagens
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image_url' || part.type === 'image') hasImages = true;
          if (part.type === 'file' || part.type === 'document') hasFiles = true;
        }
      }
    }

    if (hasFiles || hasImages || hasTools) {
      return { mode: ExecutionMode.WORKFLOW, confidence: 0.99 };
    }

    const estimatedTokens = estimatePayloadTokens(messages);
    
    // Se o token count for muito grande, provavelmente precisa de raciocínio estendido
    if (estimatedTokens > 2000) {
      return { mode: ExecutionMode.WORKFLOW, confidence: 0.95 };
    }

    // Heurística de FAST: Perguntas curtas, sem multimídia, poucas mensagens
    if (estimatedTokens < 40 && messages.length <= 2) {
      return { mode: ExecutionMode.FAST, confidence: 0.98 };
    }

    // Default: STANDARD (maioria das requisições normais)
    return { mode: ExecutionMode.STANDARD, confidence: 0.90 };
  }
}
