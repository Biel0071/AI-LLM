export interface ClusterNode {
  nodeId: string;
  host: string;
  port: number;
  role: 'leader' | 'worker';
  status: 'ONLINE' | 'OFFLINE' | 'SYNCING';
  cpuUsagePercent: number;
  ramUsagePercent: number;
  activeJobsCount: number;
  lastHeartbeat: string;
}

export class SyncCenterService {
  private nodes: Map<string, ClusterNode> = new Map();

  constructor() {
    this.registerLocalNode();
  }

  private registerLocalNode() {
    const localNode: ClusterNode = {
      nodeId: 'vps-node-primary-01',
      host: '127.0.0.1',
      port: Number(process.env.PORT || 3000),
      role: 'leader',
      status: 'ONLINE',
      cpuUsagePercent: 12.5,
      ramUsagePercent: 34.2,
      activeJobsCount: 0,
      lastHeartbeat: new Date().toISOString(),
    };
    this.nodes.set(localNode.nodeId, localNode);
  }

  public getClusterStatus() {
    return {
      clusterId: 'ai-platform-cluster-global',
      totalNodes: this.nodes.size,
      activeNodes: Array.from(this.nodes.values()).filter((n) => n.status === 'ONLINE').length,
      nodes: Array.from(this.nodes.values()),
    };
  }

  public registerNode(nodeData: Partial<ClusterNode>): ClusterNode {
    const nodeId = nodeData.nodeId || `vps-node-${Date.now()}`;
    const node: ClusterNode = {
      nodeId,
      host: nodeData.host || '0.0.0.0',
      port: nodeData.port || 3000,
      role: nodeData.role || 'worker',
      status: 'ONLINE',
      cpuUsagePercent: nodeData.cpuUsagePercent || 10,
      ramUsagePercent: nodeData.ramUsagePercent || 20,
      activeJobsCount: nodeData.activeJobsCount || 0,
      lastHeartbeat: new Date().toISOString(),
    };
    this.nodes.set(nodeId, node);
    return node;
  }

  public heartbeat(nodeId: string, metrics?: Partial<ClusterNode>): ClusterNode {
    const node = this.nodes.get(nodeId);
    if (!node) throw new Error(`Nó de cluster não encontrado: ${nodeId}`);

    node.lastHeartbeat = new Date().toISOString();
    node.status = 'ONLINE';
    if (metrics) {
      if (metrics.cpuUsagePercent !== undefined) node.cpuUsagePercent = metrics.cpuUsagePercent;
      if (metrics.ramUsagePercent !== undefined) node.ramUsagePercent = metrics.ramUsagePercent;
      if (metrics.activeJobsCount !== undefined) node.activeJobsCount = metrics.activeJobsCount;
    }
    return node;
  }
}
