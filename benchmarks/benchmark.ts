import fs from 'fs';
import path from 'path';

const API_URL = 'http://localhost:3000/v1/chat/completions';
const API_KEY = 'sk-12345'; // Configurar conforme ambiente

interface Scenario {
  name: string;
  iterations: number;
  concurrency: number;
  payload: any;
}

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

async function runScenario(scenario: Scenario): Promise<MetricData[]> {
  const metrics: MetricData[] = [];
  const { iterations, concurrency, payload } = scenario;

  console.log(`[+] Running Scenario: ${scenario.name} (${iterations} requests, concurrency: ${concurrency})`);

  let currentIdx = 0;
  
  const worker = async () => {
    while (true) {
      const idx = currentIdx++;
      if (idx >= iterations) break;
      
      const start = Date.now();
      let success = false;
      let statusCode = 0;
      let error = '';
      let gatewayTrace: any = {};
      
      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
          },
          body: JSON.stringify(payload)
        });
        
        statusCode = res.status;
        
        if (payload.stream) {
          // Consume the SSE stream
          const text = await res.text();
          // Extremely basic parse to find gateway trace (which is the first event)
          const gatewayMatch = text.match(/event:\s*gateway\ndata:\s*({.*?})\n\n/);
          if (gatewayMatch && gatewayMatch[1]) {
            gatewayTrace = JSON.parse(gatewayMatch[1]);
          }
          if (text.includes('data: [DONE]')) success = true;
          else {
             success = false;
             error = 'Stream incomplete';
          }
        } else {
          const data = await res.json();
          if (data._gateway) {
            gatewayTrace = data._gateway;
          }
          if (res.ok) success = true;
          else error = data?.error?.message || 'Unknown Error';
        }
      } catch (err: any) {
        success = false;
        error = err.message;
      }
      
      const latency = Date.now() - start;
      
      metrics.push({
        latency,
        success,
        statusCode,
        error,
        cacheHit: gatewayTrace.cache !== 'MISS' && gatewayTrace.cache !== undefined,
        provider: gatewayTrace.provider || 'unknown',
        mode: gatewayTrace.mode || 'unknown'
      });
      
      if ((idx + 1) % 50 === 0) {
        console.log(`    -> Progress: ${idx + 1}/${iterations}`);
      }
    }
  };

  const workers = Array.from({ length: concurrency }).map(() => worker());
  await Promise.all(workers);
  
  return metrics;
}

async function main() {
  const scenariosDir = path.join(__dirname, 'scenarios');
  const files = fs.readdirSync(scenariosDir).filter(f => f.endsWith('.json'));
  
  const results: Record<string, MetricData[]> = {};
  
  for (const file of files) {
    const filePath = path.join(scenariosDir, file);
    const scenario: Scenario = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    // Aquecimento (Warmup - faz o cache funcionar para as proximas chamadas)
    console.log(`[+] Warming up ${scenario.name}...`);
    try {
       await fetch(API_URL, {
         method: 'POST',
         headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
         body: JSON.stringify(scenario.payload)
       });
    } catch (e) {}
    
    const data = await runScenario(scenario);
    results[scenario.name.toLowerCase()] = data;
  }
  
  fs.writeFileSync(path.join(__dirname, 'raw-metrics.json'), JSON.stringify(results, null, 2));
  console.log('✅ Done running benchmarks. Run `npm run report` to see results.');
}

if (require.main === module) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
