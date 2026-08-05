import fs from 'fs';
import path from 'path';

function main() {
  const reportPath = path.join(__dirname, 'benchmark-report.json');
  const baselinePath = path.join(__dirname, 'benchmark-baseline.json');
  
  if (!fs.existsSync(reportPath)) {
    console.error('No report found. Run benchmark.ts and report.ts first.');
    process.exit(1);
  }
  
  if (!fs.existsSync(baselinePath)) {
    console.log('No baseline found. Saving current report as baseline.');
    fs.copyFileSync(reportPath, baselinePath);
    console.log('✅ Baseline saved to benchmark-baseline.json');
    return;
  }
  
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
  
  console.log(`\n========================`);
  console.log(`COMPARISON: Baseline vs Current`);
  console.log(`========================\n`);
  
  for (const [scenario, data] of Object.entries(report.scenarios)) {
    const baseData = baseline.scenarios[scenario];
    if (!baseData) continue;
    
    console.log(`-- ${scenario.toUpperCase()} --`);
    
    const p95Diff = ((data.p95 as number) - (baseData.p95 as number));
    const p95DiffPerc = ((p95Diff / baseData.p95) * 100).toFixed(1);
    const p95Color = p95Diff > 0 ? '🔴 Slower' : '🟢 Faster';
    console.log(`  P95: ${baseData.p95}ms -> ${data.p95}ms (${p95Diff > 0 ? '+' : ''}${p95DiffPerc}%) ${p95Color}`);
    
    const hitDiff = ((data.cacheHitRatio as number) - (baseData.cacheHitRatio as number));
    console.log(`  Cache: ${baseData.cacheHitRatio}% -> ${data.cacheHitRatio}% (${hitDiff > 0 ? '+' : ''}${hitDiff}%)`);
    
    console.log();
  }
  
  console.log('To update baseline, delete benchmark-baseline.json and run compare again.');
}

if (require.main === module) {
  main();
}
