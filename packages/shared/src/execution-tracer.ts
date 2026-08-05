import { ExecutionContext, ExecutionMetrics, TraceEvent, PlannerMetrics, SchedulerMetrics, ComposerMetrics } from './types';

export interface IExecutionTracer {
  event(type: string, component: string, details?: Record<string, any>): void;
  startPlanner(): void;
  finishPlanner(metrics: Omit<PlannerMetrics, 'startedAt' | 'finishedAt' | 'latency'>): void;
  startScheduler(): void;
  finishScheduler(metrics: Omit<SchedulerMetrics, 'startedAt' | 'finishedAt' | 'latency'>): void;
  startComposer(): void;
  finishComposer(metrics?: Omit<ComposerMetrics, 'startedAt' | 'finishedAt' | 'latency'>): void;
  getTrace(): TraceEvent[];
  getMetrics(): ExecutionMetrics;
  attachToContext(ctx: ExecutionContext): void;
}

export class MemoryExecutionTracer implements IExecutionTracer {
  private trace: TraceEvent[] = [];
  private metrics: ExecutionMetrics = {};
  
  private plannerStart?: number;
  private schedulerStart?: number;
  private composerStart?: number;
  
  event(type: string, component: string, details?: Record<string, any>): void {
    this.trace.push({
      timestamp: Date.now(),
      component,
      type,
      details
    });
  }
  
  startPlanner(): void {
    this.plannerStart = Date.now();
    this.event('start', 'planner');
  }
  
  finishPlanner(metrics: Omit<PlannerMetrics, 'startedAt' | 'finishedAt' | 'latency'>): void {
    const finishedAt = Date.now();
    const latency = this.plannerStart ? finishedAt - this.plannerStart : 0;
    
    this.metrics.planner = {
      startedAt: this.plannerStart,
      finishedAt,
      latency,
      ...metrics
    };
    
    this.event('finish', 'planner', { latency });
  }
  
  startScheduler(): void {
    this.schedulerStart = Date.now();
    this.event('start', 'scheduler');
  }
  
  finishScheduler(metrics: Omit<SchedulerMetrics, 'startedAt' | 'finishedAt' | 'latency'>): void {
    const finishedAt = Date.now();
    const latency = this.schedulerStart ? finishedAt - this.schedulerStart : 0;
    
    this.metrics.scheduler = {
      startedAt: this.schedulerStart,
      finishedAt,
      latency,
      ...metrics
    };
    
    this.event('finish', 'scheduler', { latency });
  }
  
  startComposer(): void {
    this.composerStart = Date.now();
    this.event('start', 'composer');
  }
  
  finishComposer(metrics?: Omit<ComposerMetrics, 'startedAt' | 'finishedAt' | 'latency'>): void {
    const finishedAt = Date.now();
    const latency = this.composerStart ? finishedAt - this.composerStart : 0;
    
    this.metrics.composer = {
      startedAt: this.composerStart,
      finishedAt,
      latency,
      ...(metrics || {})
    };
    
    this.event('finish', 'composer', { latency });
  }
  
  getTrace(): TraceEvent[] {
    return this.trace;
  }
  
  getMetrics(): ExecutionMetrics {
    return this.metrics;
  }
  
  attachToContext(ctx: ExecutionContext): void {
    ctx.trace = this.trace;
    ctx.metrics = this.metrics;
  }
}
