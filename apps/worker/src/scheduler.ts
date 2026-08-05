import { DagPlan, DagNode, ExecutionContext, ExecutionTrace } from '@api-platform/shared';
import { PromptRenderer } from './prompt-renderer';

// Simple concurrency limiter
function pLimit(concurrency: number) {
  const queue: Array<() => void> = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const task = queue.shift()!;
      task();
    }
  };

  return <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        activeCount++;
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          next();
        }
      };

      if (activeCount < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

export class SmartScheduler {
  constructor(
    private readonly context: ExecutionContext,
    private readonly registry: any,
    private readonly renderer: PromptRenderer
  ) {}

  async executePlan(): Promise<ExecutionTrace> {
    const { plan, budget, results, startTime: globalStartTime } = this.context as Required<import('@api-platform/shared').ExecutionContext>;
    if (!plan) throw new Error('No plan provided');

    const limit = pLimit(budget.maxParallelNodes || 2);
    const nodes = plan.nodes;
    const nodeMap = new Map<string, DagNode>(nodes.map(n => [n.id, n]));
    
    let nodesExecuted = 0;
    let nodesFailed = 0;
    let retries = 0;
    let fallbacks = 0;
    let tokensUsed = 0;
    let parallelGroups = 0;
    
    const inDegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    
    for (const node of nodes) {
      inDegree.set(node.id, (node.dependencies || []).length);
      dependents.set(node.id, []);
    }
    
    for (const node of nodes) {
      for (const dep of (node.dependencies || [])) {
        if (dependents.has(dep)) {
           dependents.get(dep)!.push(node.id);
        }
      }
    }
    
    const readyQueue: string[] = [];
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) readyQueue.push(id);
    }
    
    let activeNodes = 0;
    
    const executeNode = async (nodeId: string) => {
      const node = nodeMap.get(nodeId)!;
      const startTime = Date.now();
      
      try {
        const contextData: any = {};
        for (const dep of (node.dependencies || [])) {
           if (results[dep] && results[dep].status === 'success') {
              contextData[dep] = results[dep].result;
           }
        }
        
        const finalPrompt = this.renderer.render(node, contextData);
        
        // Resolve capabilities through ProviderRegistry logic
        // We do fallback loop natively inside the node execution (Chaos handling)
        let fallbackAttempt = 0;
        let lastError: any = null;
        let success = false;
        const maxRetries = 2;
        
        // Obter providers que suportam a capability
        const candidates = this.registry.resolveCandidates(node.capability || 'chat');
        
        if (!candidates || candidates.length === 0) {
          throw new Error(`No provider found for capability ${node.capability}`);
        }
        
        while (fallbackAttempt <= maxRetries && !success) {
           const providerObj = candidates[fallbackAttempt % candidates.length];
           try {
             if (Date.now() - (globalStartTime || Date.now()) > budget.maxExecutionTimeMs) {
                throw new Error('Execution budget timeout exceeded');
             }
             
             // Em um sistema real, o providerObj tem .chat()
             // Como o worker compartilha a mesma base de código do registry, usaremos chat()
             const res = await providerObj.chat({
               messages: [{ role: 'user', content: finalPrompt }],
               model: 'auto'
             });
             
             results[nodeId] = {
                nodeId,
                status: 'success',
                result: (res.result as any).message?.content || (res.result as any).text || JSON.stringify(res.result),
                executionTimeMs: Date.now() - startTime,
                providerUsed: providerObj.name
             };
             
             tokensUsed += (res.tokens?.total || 10);
             nodesExecuted++;
             success = true;
           } catch (err: any) {
             lastError = err;
             fallbackAttempt++;
             if (fallbackAttempt <= maxRetries) {
                fallbacks++;
                retries++;
             }
           }
        }
        
        if (!success) {
          throw lastError || new Error('Node execution failed after retries');
        }
        
      } catch (err: any) {
        nodesFailed++;
        results[nodeId] = {
           nodeId,
           status: 'failed',
           error: err.message,
           executionTimeMs: Date.now() - startTime
        };
        // Aqui o "Chaos Test" é mitigado: um nó falha, mas não estoura o worker inteiro,
        // ele apenas fica marcado como failed. Dependents dele podem falhar também.
      }
    };
    
    const executionPromises: Promise<void>[] = [];
    
    // Polling event loop to schedule tasks as soon as they become ready
    while (readyQueue.length > 0 || activeNodes > 0) {
       const currentBatch = [...readyQueue];
       readyQueue.length = 0;
       
       if (currentBatch.length > 1) {
          parallelGroups++;
          console.log(`[DAG] Scheduling nodes in parallel: ${currentBatch.join(', ')}`);
       } else if (currentBatch.length === 1) {
          console.log(`[DAG] Scheduling node: ${currentBatch[0]}`);
       }
       
       for (const nodeId of currentBatch) {
          activeNodes++;
          const promise = limit(() => executeNode(nodeId)).then(() => {
             activeNodes--;
             for (const dependentId of dependents.get(nodeId)!) {
                const newDegree = inDegree.get(dependentId)! - 1;
                inDegree.set(dependentId, newDegree);
                if (newDegree === 0) {
                   readyQueue.push(dependentId);
                }
             }
          });
          executionPromises.push(promise);
       }
       
       if (readyQueue.length === 0 && activeNodes > 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
       }
    }
    
    await Promise.all(executionPromises);
    
    return {
       executionId: this.context.executionId,
       planId: plan.planId,
       nodesCreated: nodes.length,
       nodesExecuted,
       nodesFailed,
       retries,
       fallbacks,
       latencyMs: Date.now() - this.context.startTime,
       tokensUsed,
       cost: 0,
       parallelGroups
    };
  }
}
