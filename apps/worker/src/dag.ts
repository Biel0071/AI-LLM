import { DagNode, DagPlan, ExecutionBudget } from '@api-platform/shared';

export class DagValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DagValidationError';
  }
}

export function validateDag(plan: DagPlan, budget: ExecutionBudget): void {
  if (!plan.nodes || plan.nodes.length === 0) {
    throw new DagValidationError('DAG cannot be empty.');
  }

  if (plan.nodes.length > budget.maxNodes) {
    throw new DagValidationError(`DAG exceeds max nodes (${budget.maxNodes}). Found ${plan.nodes.length}.`);
  }

  const nodeMap = new Map<string, DagNode>();
  plan.nodes.forEach(n => {
    if (nodeMap.has(n.id)) throw new DagValidationError(`Duplicate node ID: ${n.id}`);
    nodeMap.set(n.id, n);
  });

  const childrenCount = new Map<string, number>();
  const parentsCount = new Map<string, number>();

  plan.nodes.forEach(n => {
    const deps = n.dependencies || [];
    deps.forEach(dep => {
      if (!nodeMap.has(dep)) {
        throw new DagValidationError(`Node ${n.id} depends on non-existent node ${dep}`);
      }
      childrenCount.set(dep, (childrenCount.get(dep) || 0) + 1);
      parentsCount.set(n.id, (parentsCount.get(n.id) || 0) + 1);
    });
  });

  // Fan-out limit check (max 5)
  for (const [id, count] of childrenCount.entries()) {
    if (count > 5) throw new DagValidationError(`Node ${id} exceeds max fan-out (5). Found ${count}.`);
  }

  // Fan-in limit check (max 5)
  for (const [id, count] of parentsCount.entries()) {
    if (count > 5) throw new DagValidationError(`Node ${id} exceeds max fan-in (5). Found ${count}.`);
  }

  // Cycle and Depth detection
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const depthMap = new Map<string, number>();

  function dfs(nodeId: string, currentDepth: number): number {
    if (recursionStack.has(nodeId)) {
      throw new DagValidationError(`Cycle detected involving node ${nodeId}`);
    }
    
    if (visited.has(nodeId)) {
      return depthMap.get(nodeId) || 1;
    }

    visited.add(nodeId);
    recursionStack.add(nodeId);

    let maxChildDepth = 0;
    const children = plan.nodes.filter(n => (n.dependencies || []).includes(nodeId));
    
    for (const child of children) {
      const childDepth = dfs(child.id, currentDepth + 1);
      if (childDepth > maxChildDepth) {
        maxChildDepth = childDepth;
      }
    }

    recursionStack.delete(nodeId);
    const nodeMaxDepth = maxChildDepth + 1;
    depthMap.set(nodeId, nodeMaxDepth);
    return nodeMaxDepth;
  }

  const rootNodes = plan.nodes.filter(n => !n.dependencies || n.dependencies.length === 0);
  if (rootNodes.length === 0) {
    throw new DagValidationError('DAG must have at least one root node (no dependencies). Cycle likely exists.');
  }

  let maxDagDepth = 0;
  for (const root of rootNodes) {
    const depth = dfs(root.id, 1);
    if (depth > maxDagDepth) maxDagDepth = depth;
  }
  
  if (visited.size !== plan.nodes.length) {
    throw new DagValidationError('DAG contains disconnected components or cycles.');
  }

  if (maxDagDepth > 6) {
    throw new DagValidationError(`DAG exceeds max depth (6). Found depth ${maxDagDepth}.`);
  }
}
