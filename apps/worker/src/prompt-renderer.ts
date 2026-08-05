import { DagNode } from '@api-platform/shared';

export class PromptRenderer {
  render(node: DagNode, contextData: any): string {
    let finalPrompt = "";
    
    if (node.task === 'translate' && node.params?.text) {
      finalPrompt = `Translate the following text:\n${node.params.text}`;
    } else if (node.task === 'general_chat' && node.params?.text) {
      finalPrompt = node.params.text;
    } else if (node.task === 'compose') {
      finalPrompt = `Combine the following information into a final response:\n`;
    } else {
      finalPrompt = `Execute the following task: ${node.task}\n`;
      if (node.params?.original) {
        finalPrompt += `Input instruction: ${node.params.original}\n`;
      }
    }
    
    // Injeta contexto compartilhado dos nós de que dependemos (ResultStore)
    if (contextData && Object.keys(contextData).length > 0) {
      finalPrompt += `\n--- Contexto Anterior ---\n`;
      for (const [depId, data] of Object.entries(contextData)) {
        // Formata o output para o LLM entender de onde veio a informacao
        finalPrompt += `[Resultado da etapa ${depId}]:\n${typeof data === 'string' ? data : JSON.stringify(data)}\n`;
      }
      finalPrompt += `-------------------------\n`;
    }
    
    return finalPrompt;
  }
}
