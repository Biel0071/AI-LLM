import { ExecutionMode, IntentResult } from '@api-platform/shared';


export class FastIntentClassifier {
  /**
   * Classifica a requisiÃ§Ã£o baseada em heurÃ­sticas rÃ¡pidas.
   * NÃ£o utiliza LLM, resultando em latÃªncia quase nula (< 1ms).
   */
  static classify(messages: any[], options: { tools?: any[] } = {}): IntentResult {
    const hasTools = Array.isArray(options.tools) && options.tools.length > 0;
    
    let hasImages = false;
    let hasFiles = false;
    
    // Verifica conteÃºdo multimÃ­dia nas mensagens
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
    
    // Se o token count for muito grande, provavelmente precisa de raciocÃ­nio estendido
    if (estimatedTokens > 2000) {
      return { mode: ExecutionMode.WORKFLOW, confidence: 0.95 };
    }

    // HeurÃ­stica de FAST: Perguntas curtas, sem multimÃ­dia, poucas mensagens
    if (estimatedTokens < 40 && messages.length <= 2) {
      return { mode: ExecutionMode.FAST, confidence: 0.98 };
    }

    // Default: STANDARD (maioria das requisiÃ§Ãµes normais)
    return { mode: ExecutionMode.STANDARD, confidence: 0.90 };
  }
}

