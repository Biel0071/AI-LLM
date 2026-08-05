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
  latency: number; // TTLT ou end-to-end
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

export interface BenchmarkReport {
  // To be used by report.ts
  timestamp: string;
}

async function consumeStream(res: Response, start: number): Promise<{ success: boolean, gatewayTrace: any, ttft?: number, ttfb?: number, chunks: number, tokens: number, error: string }> {
  let success = false;
  let gatewayTrace: any = {};
  let ttft: number | undefined;
  let ttfb: number | undefined;
  let chunks = 0;
  let tokens = 0;
  let error = '';

  const reader = res.body?.getReader();
  if (!reader) {
     return { success: false, gatewayTrace, chunks: 0, tokens: 0, error: 'No reader' };
  }
  
  const decoder = new TextDecoder();
  
  try {
    let done = false;
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        if (!ttfb) ttfb = Date.now() - start;
        
        const chunkStr = decoder.decode(value, { stream: true });
        const lines = chunkStr.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.substring(6).trim();
            if (dataStr === '[DONE]') {
               success = true;
            } else if (dataStr.startsWith('{')) {
               try {
                 const data = JSON.parse(dataStr);
                 if (data.requestId && data.mode) {
                   gatewayTrace = data; // Gateway Trace via SSE (usually first chunk)
                 } else if (data.choices && data.choices[0]?.delta?.content) {
                   if (!ttft) ttft = Date.now() - start;
                   chunks++;
                   tokens++; // Simplification: 1 chunk = 1 token roughly, or use usage event
                 }
               } catch(e) {}
            }
          }
        }
      }
    }
  } catch (err: any) {
    error = err.message;
  }
  
  return { success, gatewayTrace, ttft, ttfb, chunks, tokens, error };
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
      
      let ttfb: number | undefined;
      let ttft: number | undefined;
      let chunks = 0;
      let tokens = 0;
      
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
          const streamResult = await consumeStream(res as any, start);
          success = streamResult.success;
          gatewayTrace = streamResult.gatewayTrace;
          ttft = streamResult.ttft;
          ttfb = streamResult.ttfb;
          chunks = streamResult.chunks;
          tokens = streamResult.tokens;
          error = streamResult.error;
        } else {
          const data = await res.json();
          if (data._gateway) {
            gatewayTrace = data._gateway;
          }
          if (res.ok) {
            success = true;
            tokens = data.usage?.total_tokens || 0;
          }
          else error = data?.error?.message || 'Unknown Error';
        }
      } catch (err: any) {
        success = false;
        error = err.message;
      }
      
      const latency = Date.now() - start;
      
      metrics.push({
        latency, // TTLT if stream
        ttfb,
        ttft,
        chunks,
        tokens,
        success,
        statusCode,
        error,
        cacheHit: gatewayTrace.cache !== 'MISS' && gatewayTrace.cache !== undefined,
        provider: gatewayTrace.provider || 'unknown',
        mode: gatewayTrace.mode || 'unknown',
        gatewayTrace
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
    
    // Aquecimento
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
