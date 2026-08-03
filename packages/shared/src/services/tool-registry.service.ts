export interface ITool {
  name: string;
  description: string;
  execute(args: Record<string, any>): Promise<any>;
}

export class ToolRegistry {
  private tools = new Map<string, ITool>();

  register(tool: ITool) {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): ITool | undefined {
    return this.tools.get(name);
  }

  listTools(): ITool[] {
    return Array.from(this.tools.values());
  }
}

export const toolRegistry = new ToolRegistry();

// Basic Stubs
toolRegistry.register({
  name: 'search',
  description: 'Searches the web for information.',
  async execute(args) {
    return { success: true, result: `Stubbed search result for query: ${args.query}` };
  },
});

toolRegistry.register({
  name: 'filesystem',
  description: 'Reads or writes to the filesystem.',
  async execute(args) {
    return { success: true, result: `Stubbed filesystem operation: ${args.operation}` };
  },
});

toolRegistry.register({
  name: 'http',
  description: 'Makes an HTTP request.',
  async execute(args) {
    return { success: true, result: `Stubbed HTTP ${args.method} to ${args.url}` };
  },
});
