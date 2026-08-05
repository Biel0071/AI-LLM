import fs from 'fs';
import path from 'path';

export interface MetricData {
  latency: number;
  ttfb?: number;
  ttft?: number;
  chunks?: number;
  tokens?: number;
  success: boolean;
  cacheHit: boolean;
  provider: string;
  mode: string;
  statusCode: number;
  error?: string;
  gatewayTrace?: any;
}

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(index, sorted.length - 1)];
}

function calculateAvg(arr: (number|undefined)[]): number {
  const valid = arr.filter(n => n !== undefined && !isNaN(n)) as number[];
  if (valid.length === 0) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

async function main() {
  const rawPath = path.join(__dirname, 'raw-metrics.json');
  if (!fs.existsSync(rawPath)) {
    console.error('No raw-metrics.json found. Run benchmark.ts first.');
    process.exit(1);
  }
  
  const rawData: Record<string, MetricData[]> = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  
  console.log(`\n========================================`);
  console.log(`       API GATEWAY BENCHMARK REPORT`);
  console.log(`========================================`);

  for (const [scenario, metrics] of Object.entries(rawData)) {
    if (metrics.length === 0) continue;

    const latencies = metrics.map(m => m.latency).sort((a, b) => a - b);
    const successes = metrics.filter(m => m.success).length;
    const cacheHits = metrics.filter(m => m.cacheHit).length;
    
    console.log(`\n--- ${scenario.toUpperCase()} ---`);
    console.log(`Requests:    ${metrics.length}`);
    console.log(`Success:     ${((successes / metrics.length) * 100).toFixed(1)}%`);
    console.log(`Cache Hit:   ${Math.round((cacheHits / metrics.length) * 100)}%`);
    
    if (scenario.includes('stream')) {
      const ttft = calculateAvg(metrics.map(m => m.ttft));
      const ttfb = calculateAvg(metrics.map(m => m.ttfb));
      const chunks = calculateAvg(metrics.map(m => m.chunks));
      const tokens = calculateAvg(metrics.map(m => m.tokens));
      const avgLatency = calculateAvg(metrics.map(m => m.latency));
      const chunksPerSec = (chunks / (avgLatency / 1000)).toFixed(1);
      const tokensPerSec = (tokens / (avgLatency / 1000)).toFixed(1);
      
      console.log(`TTFB:        ${ttfb}ms`);
      console.log(`TTFT:        ${ttft}ms`);
      console.log(`TTLT:        ${avgLatency}ms`);
      console.log(`Chunks/s:    ${chunksPerSec}`);
      console.log(`Tokens/s:    ${tokensPerSec}`);
      
    } else if (scenario.includes('workflow')) {
      const plannerLatencies = calculateAvg(metrics.map(m => m.gatewayTrace?.metrics?.planner?.latency));
      const schedulerLatencies = calculateAvg(metrics.map(m => m.gatewayTrace?.metrics?.scheduler?.latency));
      const composerLatencies = calculateAvg(metrics.map(m => m.gatewayTrace?.metrics?.composer?.latency));
      const parallelGroups = calculateAvg(metrics.map(m => m.gatewayTrace?.metrics?.scheduler?.parallelGroups));
      
      console.log(`P95 Latency: ${calculatePercentile(latencies, 95)}ms`);
      console.log(`Planner:     ${plannerLatencies}ms`);
      console.log(`Scheduler:   ${schedulerLatencies}ms`);
      console.log(`Composer:    ${composerLatencies}ms`);
      console.log(`ParallelGrps:${parallelGroups}`);
      
      const trace = metrics[0]?.gatewayTrace?.trace;
      if (trace && trace.length > 0) {
        console.log(`\nTRACE SAMPLE:`);
        trace.forEach((event: any) => {
          console.log(`  -> [${event.component}] ${event.type} (${event.details ? JSON.stringify(event.details) : ''})`);
        });
      }
    } else {
      console.log(`P50 Latency: ${calculatePercentile(latencies, 50)}ms`);
      console.log(`P95 Latency: ${calculatePercentile(latencies, 95)}ms`);
      console.log(`P99 Latency: ${calculatePercentile(latencies, 99)}ms`);
    }
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
