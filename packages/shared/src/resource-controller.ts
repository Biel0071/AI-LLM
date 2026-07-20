export interface ResourceSnapshot {
  memoryAvailableBytes: number;
  memoryTotalBytes: number;
  swapFreeBytes: number;
  swapTotalBytes: number;
  cpuLoadRatio: number;
}

export interface ResourceDecision {
  concurrency: number;
  memoryAvailableRatio: number;
  swapUsedRatio: number;
  cpuLoadRatio: number;
  pressure: 'normal' | 'constrained' | 'critical';
  reasons: string[];
}

const KIB = 1024;

export function parseProcMeminfo(text: string): Omit<ResourceSnapshot, 'cpuLoadRatio'> | undefined {
  const values = new Map<string, number>();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_()]+):\s+(\d+)\s+kB$/);
    if (match) values.set(match[1], Number(match[2]) * KIB);
  }
  const memoryTotalBytes = values.get('MemTotal') ?? 0;
  const memoryAvailableBytes = values.get('MemAvailable') ?? values.get('MemFree') ?? 0;
  if (!memoryTotalBytes) return undefined;
  return {
    memoryAvailableBytes,
    memoryTotalBytes,
    swapFreeBytes: values.get('SwapFree') ?? 0,
    swapTotalBytes: values.get('SwapTotal') ?? 0,
  };
}

export function decideConcurrency(snapshot: ResourceSnapshot, maximum: number): ResourceDecision {
  const max = Math.max(1, Math.floor(maximum));
  const memoryAvailableRatio = snapshot.memoryAvailableBytes / Math.max(1, snapshot.memoryTotalBytes);
  const swapUsedRatio = snapshot.swapTotalBytes > 0
    ? 1 - snapshot.swapFreeBytes / snapshot.swapTotalBytes
    : 0;
  const reasons: string[] = [];

  if (memoryAvailableRatio < 0.1) reasons.push('memory_critical');
  if (snapshot.cpuLoadRatio > 1.35) reasons.push('cpu_critical');
  if (swapUsedRatio > 0.97 && memoryAvailableRatio < 0.3) reasons.push('swap_critical');
  if (reasons.length) {
    return { concurrency: 1, memoryAvailableRatio, swapUsedRatio, cpuLoadRatio: snapshot.cpuLoadRatio, pressure: 'critical', reasons };
  }

  if (memoryAvailableRatio < 0.25) reasons.push('memory_constrained');
  if (snapshot.cpuLoadRatio > 0.85) reasons.push('cpu_constrained');
  if (swapUsedRatio > 0.85 && memoryAvailableRatio < 0.35) reasons.push('swap_constrained');
  if (reasons.length) {
    return {
      concurrency: Math.max(1, Math.ceil(max / 2)),
      memoryAvailableRatio, swapUsedRatio, cpuLoadRatio: snapshot.cpuLoadRatio,
      pressure: 'constrained', reasons,
    };
  }

  return {
    concurrency: max, memoryAvailableRatio, swapUsedRatio,
    cpuLoadRatio: snapshot.cpuLoadRatio, pressure: 'normal', reasons: [],
  };
}