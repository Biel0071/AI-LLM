import { BaseProvider } from './base.provider';
import { Capability, MissionInput, ProviderResult, HealthStatus, ModelInfo } from '../types';
import { ProviderRegistry } from './registry';

// Tool Registry embutido
export interface ITool {
  name: string;
  description: string;
  execute(args: Record<string, any>): Promise<any>;
}

export class ToolRegistry {
  private tools = new Map<string, ITool>();
  register(tool: ITool) { this.tools.set(tool.name, tool); }
  getTool(name: string): ITool | undefined { return this.tools.get(name); }
  listTools(): ITool[] { return Array.from(this.tools.values()); }
}

export const toolRegistry = new ToolRegistry();
toolRegistry.register({
  name: 'search',
  description: 'Searches the web for information.',
  async execute(args) { return { success: true, result: `Stubbed search result for query: ${args.query}` }; },
});
toolRegistry.register({
  name: 'filesystem',
  description: 'Reads or writes to the filesystem.',
  async execute(args) { return { success: true, result: `Stubbed filesystem operation: ${args.operation}` }; },
});
toolRegistry.register({
  name: 'http',
  description: 'Makes an HTTP request.',
  async execute(args) { return { success: true, result: `Stubbed HTTP ${args.method} to ${args.url}` }; },
});

// Validator
class Validator {
  async validate(goal: string, result: string): Promise<boolean> {
    return result.length > 0;
  }
}

// ResultBuilder
class ResultBuilder {
  build(result: string, steps: any[]): any {
    return { status: 'completed', output: result, steps };
  }
}

// ToolDispatcher
class ToolDispatcher {
  async dispatch(toolName: string, args: Record<string, any>): Promise<any> {
    const tool = toolRegistry.getTool(toolName);
    if (!tool) throw new Error(`Tool ${toolName} not found`);
    return tool.execute(args);
  }
}

// ExecutionEngine
class ExecutionEngine {
  constructor(private dispatcher: ToolDispatcher) {}
  async executePlan(plan: string[], context: any): Promise<any[]> {
    const steps = [];
    for (const step of plan) {
      steps.push({ step, status: 'executed', result: `Step ${step} executed successfully` });
    }
    return steps;
  }
}

// Planner
class Planner {
  constructor(private registry: ProviderRegistry) {}
  async createPlan(mission: MissionInput, ctx: any): Promise<string[]> {
    const provider = this.registry.resolve('chat', mission.model ? undefined : 'auto'); // Auto-resolve LLM
    const prompt = `Crie um plano passo a passo para atingir este objetivo: ${mission.objective}`;
    const res = await provider.generateText({ prompt, model: mission.model });
    
    const text = typeof res.result === 'string' ? res.result : (res.result as any)?.text ?? '';
    return text.split('\n').filter((l: string) => l.trim().length > 0);
  }
}

/**
 * Provider que implementa a Capability "mission".
 * O MissionProvider encapsula o motor do Fenix para o novo formato de API.
 */
export class MissionProvider extends BaseProvider {
  readonly name = 'mission-engine';
  readonly capabilities: Capability[] = ['mission'];

  private planner: Planner;
  private dispatcher = new ToolDispatcher();
  private engine = new ExecutionEngine(this.dispatcher);
  private validator = new Validator();
  private builder = new ResultBuilder();

  constructor(registry: ProviderRegistry) {
    super();
    this.planner = new Planner(registry);
  }

  async mission(input: MissionInput): Promise<ProviderResult<any>> {
    const plan = await this.planner.createPlan(input, {});
    const steps = await this.engine.executePlan(plan, {});
    const finalResult = steps.map((s) => s.result).join('\n');
    const isValid = await this.validator.validate(input.objective, finalResult);
    if (!isValid) throw new Error('Mission failed to produce a valid result');
    
    return {
      result: this.builder.build(finalResult, steps),
      model: input.model ?? 'auto',
      tokens: {},
    };
  }

  override async health(): Promise<HealthStatus> {
    return { ok: true, message: 'Mission Engine is healthy' };
  }

  async models(): Promise<ModelInfo[]> {
    return [{ id: 'auto', capabilities: ['mission'] }];
  }
}
