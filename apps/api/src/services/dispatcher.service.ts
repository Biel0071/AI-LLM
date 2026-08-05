import { DispatchDecision, ExecutionContext, ExecutionMode, ExecutionTransport } from '@api-platform/shared';

export class ExecutionDispatcher {
  /**
   * Determina a política de execução baseada no contexto.
   * Pode ser expandido com Rate Limits, Shadow Execution, Priority, etc.
   */
  static dispatch(payload: any, ctx: ExecutionContext): DispatchDecision {
    const mode = ctx.decision?.mode || ExecutionMode.STANDARD;
    const stream = ctx.decision?.stream || false;

    // Transporte Base
    let transport = ExecutionTransport.DIRECT;
    if (mode === ExecutionMode.WORKFLOW) {
      transport = ExecutionTransport.QUEUE;
    }

    // Política de Prioridade (1 a 10)
    let priority = 5;
    if (mode === ExecutionMode.FAST) priority = 1;
    else if (mode === ExecutionMode.STANDARD) priority = 5;
    else if (mode === ExecutionMode.WORKFLOW) priority = 8;
    
    // Usuários premium / tenants VIP
    if (ctx.tenant === 'vip') priority -= 1; 

    // Política de Timeout
    let timeoutMs = 60_000;
    if (mode === ExecutionMode.FAST) timeoutMs = 5_000;
    else if (mode === ExecutionMode.STANDARD) timeoutMs = 15_000;
    else if (mode === ExecutionMode.WORKFLOW) timeoutMs = 120_000;

    // Retry & Rate Limit (Placeholders para próximas fases)
    const retryPolicy = mode === ExecutionMode.FAST ? 'NONE' : 'EXPONENTIAL_BACKOFF';
    const rateLimitPolicy = 'TIER_DEFAULT';

    // Gravação das métricas de Dispatcher 
    // Em produção, isso alimentaria o Prometheus / Grafana (ex: dispatcher_requests_total)
    console.log(`[Dispatcher Metrics] MODE=${mode} TRANSPORT=${transport} TENANT=${ctx.tenant}`);

    return {
      transport,
      priority,
      timeoutMs,
      retryPolicy,
      rateLimitPolicy
    };
  }
}
