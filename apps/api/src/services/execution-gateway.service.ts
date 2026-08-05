import { 
  ExecutionContext, 
  ExecutionDecision, 
  ExecutionMode, 
  ExecutionTransport,
  ProviderResponse, 
  Capability,
  ProviderError,
  MemoryExecutionTracer
} from '@repo/shared';
import { cacheService } from './cache.service';
import { ComplexityAnalyzer } from './complexity.analyzer';
import { FastIntentClassifier } from './intent.classifier';
import { ExecutionDispatcher } from './dispatcher.service';
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
      const rawResult = result as any;
      
      if (rawResult?.result?.metrics) {
        ctx.metrics = { ...ctx.metrics, ...rawResult.result.metrics };
      }
      if (rawResult?.result?.tracerEvents) {
        ctx.trace = [...(ctx.trace || []), ...rawResult.result.tracerEvents];
      }
      
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
    
    const tracer = new MemoryExecutionTracer();
    const ctx: ExecutionContext = {
      executionId,
      traceId,
      tenant,
      cacheHit: 'MISS',
      plannerUsed: false,
      queueUsed: false,
      metadata: { payload },
      startTime: Date.now()
    };
    
    tracer.attachToContext(ctx);
    tracer.event('start', 'gateway');

    // 1. Semantic Prompt Fingerprint & Cache
    tracer.event('start', 'cache_lookup');
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
        tracer.event('finish', 'cache_lookup', { hit: cached.hit });
        tracer.event('finish', 'gateway');
        return { ctx, response: ResponseComposer.compose(ctx, cached.data as ProviderResponse<any>) };
      }
    }
    tracer.event('finish', 'cache_lookup', { hit: 'MISS' });
    
    // 2. Fast Intent Classifier
    tracer.event('start', 'intent_classifier');
    const intent = FastIntentClassifier.classify(messages, { tools: payload.tools });
    let mode = intent.mode;
    tracer.event('finish', 'intent_classifier', { mode, confidence: intent.confidence });
    
    // 3. Complexity (only if WORKFLOW)
    if (mode === ExecutionMode.WORKFLOW) {
      tracer.event('start', 'complexity_analyzer');
      ctx.complexity = ComplexityAnalyzer.analyze(messages, model, { stream, tools: payload.tools });
      tracer.event('finish', 'complexity_analyzer');
    }
    
    ctx.decision = { mode, transport: ExecutionTransport.DIRECT, stream, reason: `Confidence: ${intent.confidence}` };
    
    // 4. Dispatch Policy
    tracer.event('start', 'dispatcher');
    ctx.dispatch = ExecutionDispatcher.dispatch(payload, ctx);
    tracer.event('finish', 'dispatcher', { transport: ctx.dispatch.transport });
    
    // Update transport based on dispatch policy
    ctx.decision.transport = ctx.dispatch.transport;
    
    // 5. Execution
    tracer.event('start', 'executor', { transport: ctx.decision.transport });
    const executor = ExecutorFactory.getExecutor(ctx.decision.transport);
    const rawResponse = await executor.execute(ctx, payload);
    tracer.event('finish', 'executor');
    
    // 5. Compose
    tracer.startComposer();
    const response = ResponseComposer.compose(ctx, rawResponse);
    tracer.finishComposer();
    
    // 6. Save to Cache
    if (!stream && response && !('stream' in response)) {
      await cacheService.set(cacheKey, response);
    }
    
    if (ctx.metrics) {
      ctx.metrics.totalLatency = Date.now() - (ctx.startTime || Date.now());
      ctx.metrics.cacheHit = ctx.cacheHit !== 'MISS';
    }
    tracer.event('finish', 'gateway');
    
    return { ctx, response };
  }
}
