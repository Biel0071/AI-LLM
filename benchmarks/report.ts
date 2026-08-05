import fs from 'fs';
import path from 'path';

export interface MetricData {
  latency: number;
  success: boolean;
  cacheHit: boolean;
  provider: string;
  mode: string;
  statusCode: number;
  error?: string;
}

export interface BenchmarkReport {
  timestamp: string;
  scenarios: Record<string, {
    requests: number;
    success: number;
    failures: number;
    avg: number;
    median: number;
    p95: number;
    p99: number;
    max: number;
    cacheHitCount: number;
    cacheHitRatio: number;
    providers: Record<string, number>;
    modes: Record<string, number>;
  }>;
}

function calculatePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(index, sorted.length - 1)];
}

async function main() {
  const rawPath = path.join(__dirname, 'raw-metrics.json');
  if (!fs.existsSync(rawPath)) {
    console.error('No raw-metrics.json found. Run benchmark.ts first.');
    process.exit(1);
  }
  
  const rawData: Record<string, MetricData[]> = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));
  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    scenarios: {}
  };

  for (const [scenario, metrics] of Object.entries(rawData)) {
    if (metrics.length === 0) continue;

    const latencies = metrics.map(m => m.latency).sort((a, b) => a - b);
    const sum = latencies.reduce((a, b) => a + b, 0);
    
    const successes = metrics.filter(m => m.success).length;
    const cacheHits = metrics.filter(m => m.cacheHit).length;
    
    const providers: Record<string, number> = {};
    const modes: Record<string, number> = {};
    
    metrics.forEach(m => {
      providers[m.provider] = (providers[m.provider] || 0) + 1;
      modes[m.mode] = (modes[m.mode] || 0) + 1;
    });

    report.scenarios[scenario] = {
      requests: metrics.length,
      success: successes,
      failures: metrics.length - successes,
      avg: Math.round(sum / metrics.length),
      median: calculatePercentile(latencies, 50),
      p95: calculatePercentile(latencies, 95),
      p99: calculatePercentile(latencies, 99),
      max: latencies[latencies.length - 1],
      cacheHitCount: cacheHits,
      cacheHitRatio: Math.round((cacheHits / metrics.length) * 100),
      providers,
      modes
    };
  }
  
  const reportPath = path.join(__dirname, 'benchmark-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  // Print nicely formatted output
  for (const [scenario, data] of Object.entries(report.scenarios)) {
    console.log(`\n========================`);
    console.log(`${scenario.toUpperCase()}`);
    console.log(`========================`);
    console.log(`Requests: ${data.requests}`);
    console.log(`Success:  ${((data.success / data.requests) * 100).toFixed(1)}%`);
    console.log(`Avg:      ${data.avg}ms`);
    console.log(`Median:   ${data.median}ms`);
    console.log(`P95:      ${data.p95}ms`);
    console.log(`P99:      ${data.p99}ms`);
    console.log(`Max:      ${data.max}ms`);
    console.log(`CacheHit: ${data.cacheHitRatio}%`);
    
    console.log(`\nProvider Distribution:`);
    for (const [p, c] of Object.entries(data.providers)) {
      console.log(`  ${p}: ${((c / data.requests) * 100).toFixed(1)}%`);
    }
    
    console.log(`\nMode Distribution:`);
    for (const [m, c] of Object.entries(data.modes)) {
      console.log(`  ${m}: ${((c / data.requests) * 100).toFixed(1)}%`);
    }
  }
  
  console.log(`\n✅ Report saved to benchmark-report.json`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
