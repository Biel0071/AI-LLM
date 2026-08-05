import { 
  ExecutionContext, 
  ExecutionDecision, 
  ExecutionMode, 
  ExecutionTransport,
  ProviderResponse, 
  Capability,
  ProviderError,
} from '@repo/shared';
import { cacheService } from './cache.service';
import { ComplexityAnalyzer } from './complexity.analyzer';
import { FastIntentClassifier } from './intent.classifier';
import { ProviderRegistry } from '@repo/shared/src/providers/registry';
import { enqueueAndWait } from './queue.service';
import crypto from 'crypto';

export interface Executor {
  execute(ctx: ExecutionContext, input: any): Promise<ProviderResponse<any>>;
}

export class DirectExecutor implements Executor {
  async execute(ctx: ExecutionContext, input: any): Promise<ProviderResponse<any>> {
    let capability: Capability = 'chat';
    if (ctx.complexity?.requiresVision) capability = 'vision';
    
    const provider = ProviderRegistry.getProvider({
      capability,
      stream: ctx.decision?.stream,
    });
    
    if (!provider) {
      throw new ProviderError('System', 'No provider available for the required capability', 'NO_PROVIDER', 503);
    }
    
    const start = Date.now();
    try {
      let res: ProviderResponse<any>;
      if (capability === 'vision') {
        res = await provider.vision(input);
      } else {
        res = await provider.chat(input);
      }
      
      ctx.metrics = { ...ctx.metrics, latency: Date.now() - start };
      return res;
    } catch (error) {
      ctx.metrics = { ...ctx.metrics, latency: Date.now() - start };
      throw error;
    }
  }
}

export class QueueExecutor implements Executor {
  async execute(ctx: ExecutionContext, input: any): Promise<ProviderResponse<any>> {
    const start = Date.now();
    let queueName: 'vision' | 'text' | 'chat' | 'mission' = 'text';
    if (ctx.complexity?.requiresVision) queueName = 'vision';
    
    try {
      const { jobId, result } = await enqueueAndWait(queueName as any, {
        ...input,
        stream: false, 
        execution: { traceId: ctx.traceId, executionId: ctx.executionId }
      }, {
        tenantId: ctx.tenant
      });
      
      ctx.metrics = { ...ctx.metrics, latency: Date.now() - start };
      ctx.queueUsed = true;
      ctx.plannerUsed = true; // For WORKFLOW/Queue we assume planner was used in worker
      
      return result as ProviderResponse<any>;
    } catch (error) {
      ctx.metrics = { ...ctx.metrics, latency: Date.now() - start };
      throw error;
    }
  }
}

export class ExecutorFactory {
  static getExecutor(transport: ExecutionTransport): Executor {
    return transport === ExecutionTransport.DIRECT 
      ? new DirectExecutor() 
      : new QueueExecutor();
  }
}

export class ResponseComposer {
  static compose(ctx: ExecutionContext, response: ProviderResponse<any>): ProviderResponse<any> {
    // In the future this handles multi-provider response assembly.
    // For now, it acts as a consistent pass-through and metrics decorator.
    
    if (!('stream' in response) || !response.stream) {
      const syncResponse = response as any;
      if (!syncResponse.tokens) {
         syncResponse.tokens = { prompt: 0, completion: 0, total: 0 };
      }
    }
    
    return response;
  }
}

export class ExecutionGateway {
  static async execute(tenant: string, payload: any, forceStream: boolean = false): Promise<{ ctx: ExecutionContext, response: ProviderResponse<any> }> {
    const traceId = crypto.randomUUID();
    const executionId = crypto.randomUUID();
    
    const messages = payload.messages || [];
    const model = payload.model || 'auto';
    const stream = payload.stream === true || forceStream;
    
    const ctx: ExecutionContext = {
      executionId,
      traceId,
      tenant,
      cacheHit: 'MISS',
      plannerUsed: false,
      queueUsed: false,
      metadata: { payload },
      metrics: { startTime: Date.now() }
    };

    // 1. Semantic Prompt Fingerprint & Cache
    const cacheKey = cacheService.generateKey({
      model,
      messages,
      prompt: payload.prompt,
      temperature: payload.temperature,
      top_p: payload.top_p,
      tools: payload.tools,
      system: payload.system,
      tenant
    });
    
    if (!stream) {
      const cached = await cacheService.get(cacheKey);
      if (cached.hit !== 'MISS' && cached.data) {
        ctx.cacheHit = cached.hit;
        ctx.decision = { mode: ExecutionMode.FAST, transport: ExecutionTransport.DIRECT, stream: false, reason: 'CACHE_HIT' };
        ctx.metrics.latency = Date.now() - ctx.metrics.startTime;
        return { ctx, response: ResponseComposer.compose(ctx, cached.data as ProviderResponse<any>) };
      }
    }
    
    // 2. Fast Intent Classifier
    const intent = FastIntentClassifier.classify(messages, { tools: payload.tools });
    let mode = intent.mode;
    
    // 3. ExecutionDecision & Complexity (only if WORKFLOW)
    let transport = ExecutionTransport.DIRECT;
    
    if (mode === ExecutionMode.WORKFLOW) {
      ctx.complexity = ComplexityAnalyzer.analyze(messages, model, { stream, tools: payload.tools });
      transport = ExecutionTransport.QUEUE; // For workflow, push to worker (which runs planner)
    }
    
    // Se o usuário pediu stream e é WORKFLOW, no momento BullMQ n suporta SSE direto pra nós (a não ser que implementado Redis PubSub).
    // Mas vamos manter a decisão ortogonal.
    if (stream && transport === ExecutionTransport.QUEUE) {
      // By default, queue executor doesn't stream. For now we will allow it to fail or fallback.
    }
    
    ctx.decision = { mode, transport, stream, reason: `Confidence: ${intent.confidence}` };
    
    // 4. Execution
    const executor = ExecutorFactory.getExecutor(ctx.decision.transport);
    const rawResponse = await executor.execute(ctx, payload);
    
    // 5. Compose
    const response = ResponseComposer.compose(ctx, rawResponse);
    
    // 6. Save to Cache
    if (!stream && response && !('stream' in response)) {
      await cacheService.set(cacheKey, response);
    }
    
    ctx.metrics.endTime = Date.now();
    ctx.metrics.totalLatency = ctx.metrics.endTime - ctx.metrics.startTime;
    
    return { ctx, response };
  }
}
