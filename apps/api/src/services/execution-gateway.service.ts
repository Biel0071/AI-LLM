import { 
  ExecutionContext, 
  ExecutionDecision, 
  ExecutionMode, 
  ExecutionTransport,
  ProviderResponse, 
  Capability,
  ProviderError,
  MemoryExecutionTracer
} from '@api-platform/shared';
import { cacheService } from './cache.service';
import { ComplexityAnalyzer } from './complexity.analyzer';
import { FastIntentClassifier } from './intent.classifier';
import { ExecutionDispatcher } from './dispatcher.service';
import { ProviderRegistry, compressContext, getModelTraits } from '@api-platform/shared';
import { registry, providerCircuit, fallbackOrder } from './ai.service';
import { enqueueAndWait } from './queue.service';
import crypto from 'crypto';

export interface Executor {
  execute(ctx: ExecutionContext, input: any): Promise<ProviderResponse<any>>;
}

export class DirectExecutor implements Executor {
  async execute(ctx: ExecutionContext, input: any): Promise<ProviderResponse<any>> {
    console.log('[GATEWAY] Entrando no DirectExecutor com input:', { model: input.model, messageCount: input.messages?.length });
    let capability: Capability = 'chat';
    if (ctx.complexity?.requiresVision) capability = 'vision';
    
    let targetModel = input.model || 'auto';
    const originalMessages = input.messages || [];
    let currentMessages = [...originalMessages];
    
    // Lista de fallback baseada na ordem configurada
    let cascade = [...fallbackOrder];
    
    // Se o cliente especificou um provedor no modelo, tentamos ele primeiro
    const modelParts = targetModel.split('/');
    if (modelParts.length > 1 && cascade.includes(modelParts[0])) {
      cascade = [modelParts[0], ...cascade.filter(p => p !== modelParts[0])];
    }
    
    const errors: any[] = [];
    
    for (const providerName of cascade) {
      console.log(`[FALLBACK] Tentando provider: ${providerName}`);
      if (providerCircuit.isOpen(providerName)) {
         ctx.trace?.push({ type: 'circuit_breaker', timestamp: Date.now(), metadata: { providerName } } as any);
         continue; // Provider ignorado porque esta unhealthy
      }
      
      let provider;
      try {
        provider = await registry.resolve(capability, providerName);
      } catch {
        continue;
      }
      
      if (!provider) continue;

      // Fase 1 & Fase 2: Smart Context Manager & Token Manager
      const modelTraits = getModelTraits(targetModel);
      const maxContext = modelTraits.maxContextTokens || 8192;
      
      console.log(`[COMPRESS] Iniciando compressao. Max Context: ${maxContext}`);
      // Comprimir contexto dinamicamente para os limites do provedor atual na cascata
      const { compressedMessages, compressedSystem } = compressContext(currentMessages, maxContext, input.system);
      console.log(`[COMPRESSED] Contexto comprimido. Total msgs: ${compressedMessages.length}`);
      
      const providerInput = {
        ...input,
        messages: compressedMessages,
        system: compressedSystem
      };

      const start = Date.now();
      
      // Fase 4: Rate Limit Manager (Retry com Exponential Backoff)
      let attempt = 0;
      const maxAttempts = 3;
      let successResponse: ProviderResponse<any> | null = null;
      
      while (attempt < maxAttempts) {
        console.log(`[PROVIDER] Fazendo chamada ao provedor ${providerName} (attempt ${attempt + 1})`);
        try {
          if (capability === 'vision') {
            successResponse = await provider.vision(providerInput);
          } else {
            successResponse = await provider.chat(providerInput);
          }
          providerCircuit.recordSuccess(providerName);
          break; // Sucesso!
        } catch (error: any) {
          const status = error?.status || error?.statusCode;
          const msgString = error?.message?.toLowerCase() || '';
          const isRateLimit = status === 429 || msgString.includes('rate limit') || msgString.includes('too many requests');
          const isPayloadTooLarge = status === 413 || msgString.includes('too large') || msgString.includes('maximum context length');
          
          if (isRateLimit) {
             console.log(`[RETRY] Rate limit detectado no provider ${providerName}`);
             attempt++;
             if (attempt >= maxAttempts) {
                providerCircuit.recordFailure(providerName);
                errors.push(error);
                break;
             }
             // Backoff exponencial: 1s, 2s, 4s, 8s...
             const retryAfter = error?.headers?.['retry-after'] ? parseInt(error.headers['retry-after']) * 1000 : Math.pow(2, attempt - 1) * 1000;
             ctx.trace?.push({ type: 'rate_limit_retry', timestamp: Date.now(), metadata: { providerName, attempt, retryAfter } } as any);
             await new Promise(r => setTimeout(r, retryAfter));
             continue; // Tenta de novo no mesmo provedor
          }
          
          if (isPayloadTooLarge) {
             console.log(`[RETRY] Payload Too Large detectado no provider ${providerName}. Ajustando limite.`);
             // Reduz o maxContext em 20% e tenta comprimir de novo
             const reducedLimit = Math.floor(maxContext * 0.8);
             const recompressed = compressContext(currentMessages, reducedLimit, input.system);
             providerInput.messages = recompressed.compressedMessages;
             providerInput.system = recompressed.compressedSystem;
             ctx.trace?.push({ type: 'context_compressed', timestamp: Date.now(), metadata: { providerName, reducedLimit } } as any);
             attempt++;
             continue; 
          }
          
          // Outros erros
          providerCircuit.recordFailure(providerName);
          errors.push(error);
          break; // Vai para o proximo fallback provider
        }
      }
      
      if (successResponse) {
        console.log(`[FINISHED] Sucesso com provedor ${providerName}`);
        ctx.metrics = { ...ctx.metrics, provider: providerName, retries: attempt } as any;
        return successResponse;
      }
    }
    
    // Fallback total falhou
    ctx.metrics = { ...ctx.metrics, } as any;
    const gatewayError = new ProviderError('gateway', 'All providers in fallback chain failed.', 'ALL_FAILED', 502, false);
    (gatewayError as any).errors = errors;
    throw gatewayError;
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
      
      ctx.metrics = { ...ctx.metrics, } as any;
      ctx.queueUsed = true;
      ctx.plannerUsed = true; // For WORKFLOW/Queue we assume planner was used in worker
      
      return result as ProviderResponse<any>;
    } catch (error) {
      ctx.metrics = { ...ctx.metrics, } as any;
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



