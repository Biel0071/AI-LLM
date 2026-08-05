import { ComplexityResult } from '@api-platform/shared';


export class ComplexityAnalyzer {
  /**
   * AvaliaÃ§Ã£o profunda da complexidade executada APENAS no nÃ­vel WORKFLOW.
   */
  static analyze(messages: any[], model: string, options: { stream?: boolean, tools?: any[] } = {}): ComplexityResult {
    const estimatedTokens = ((...args: any[]) => 0)(messages);
    const hasTools = Array.isArray(options.tools) && options.tools.length > 0;
    
    let hasImages = false;
    let hasFiles = false;
    
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image_url' || part.type === 'image') hasImages = true;
          if (part.type === 'file' || part.type === 'document') hasFiles = true;
        }
      }
    }

    // Calcula um orÃ§amento estimado
    const estimatedCost = (estimatedTokens / 1000) * 0.0015; // Custo genÃ©rico de base
    const estimatedLatency = estimatedTokens * 2.5 + (hasTools ? 2000 : 0) + (hasImages ? 3000 : 0);
    
    // Define qual provedor seria melhor com base na carga
    let suggestedProvider = 'claude';
    if (hasImages) suggestedProvider = 'openai';
    if (estimatedTokens > 100000) suggestedProvider = 'gemini';

    return {
      estimatedTokens,
      estimatedLatency,
      estimatedCost,
      suggestedProvider,
      plannerThreshold: 0.75, // Limiar padrÃ£o para exigir um planner no DAG
      executionBudget: Math.max(5000, estimatedLatency * 2), // Budget base de execuÃ§Ã£o
      requiresPlanner: estimatedTokens > 4000 || hasTools || hasFiles,
      requiresTools: hasTools,
      requiresVision: hasImages,
      requiresFiles: hasFiles,
      requiresImages: hasImages,
      requiresStreaming: !!options.stream,
    };
  }
}


