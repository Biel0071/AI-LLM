import { DagPlan, DagNode, ExecutionBudget } from '@api-platform/shared';
import { validateDag } from './dag';

export class HybridPlanner {
  constructor(private readonly budget: ExecutionBudget) {}

  async plan(prompt: string, context?: any): Promise<{ plan: DagPlan; plannerTimeMs: number }> {
    const startTime = Date.now();
    let plan = this.heuristicPlan(prompt);
    
    if (!plan) {
      plan = await this.llmPlan(prompt);
    }
    
    validateDag(plan, this.budget);
    
    return {
      plan,
      plannerTimeMs: Date.now() - startTime
    };
  }

  private heuristicPlan(prompt: string): DagPlan | null {
    const lower = prompt.toLowerCase();
    
    const translateMatch = prompt.match(/^\/?(traduz[a-z]*|translate)\s+(.*)/i);
    if (translateMatch) {
      return {
        planId: `plan_${Date.now()}`,
        nodes: [
          {
            id: 'node_1',
            task: 'translate',
            capability: 'chat',
            dependencies: [],
            priority: 1,
            params: { text: translateMatch[2] }
          }
        ]
      };
    }
    
    if (!lower.includes(' e ') && !lower.includes('then') && !lower.includes('depois') && !lower.includes('->')) {
       return {
         planId: `plan_${Date.now()}`,
         nodes: [
           {
             id: 'node_1',
             task: 'general_chat',
             capability: 'chat',
             dependencies: [],
             priority: 1,
             params: { text: prompt }
           }
         ]
       };
    }
    
    return null;
  }

  private async llmPlan(prompt: string): Promise<DagPlan> {
    const nodes: DagNode[] = [];
    
    // Emula um parser de intents complexas. Em produção bateria no LLM (ex: Groq).
    const parts = prompt.split(/\s+(?:e|then|depois|->)\s+/i);
    
    // Exemplo de parser paralelo: se o prompt pedir coisas separadas
    let hasParallel = false;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim();
      const isParallelTrigger = part.includes('ao mesmo tempo') || part.includes('paralelo');
      
      let deps: string[] = [];
      if (i > 0 && !hasParallel) {
         deps = [`node_${i}`]; // Sequencial
      }
      
      if (isParallelTrigger) {
         hasParallel = true;
      }
      
      nodes.push({
        id: `node_${i+1}`,
        task: part,
        capability: 'chat',
        dependencies: deps,
        priority: 1,
        params: { original: part }
      });
    }
    
    // Se houve paralelismo, cria um nó final (Composer) para juntar tudo
    if (hasParallel || nodes.length > 1) {
       const allNodeIds = nodes.map(n => n.id);
       nodes.push({
         id: `node_composer`,
         task: 'compose',
         capability: 'chat',
         dependencies: allNodeIds,
         priority: 10,
         params: { original: 'Combine os resultados anteriores em uma resposta final unificada' }
       });
    }
    
    return {
      planId: `plan_llm_${Date.now()}`,
      nodes
    };
  }
}
