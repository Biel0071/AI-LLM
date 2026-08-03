const fs = require('fs');
const files = [
  'src/routes/admin/images.ts',
  'src/routes/admin/providers.ts',
  'src/routes/v1/index.ts',
  'src/routes/v1/openai-compat.ts',
  'src/services/ai.service.ts'
];
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  content = content.replace(/'text'/g, "'chat'");
  content = content.replace(/'embed'/g, "'embedding'");
  content = content.replace(/'upscale'/g, "'image'");
  content = content.replace(/p\.capabilities\.includes\('image'\) && typeof p\.image === 'function'/g, "p.capabilities.includes('image') && typeof (p as any).upscale === 'function'");
  content = content.replace(/typeof \(p as any\)\.image/g, "typeof (p as any).upscale");
  content = content.replace(/provider\.image\(/g, "(provider as any).upscale(");
  content = content.replace(/enqueueWithTiming\('mission',/g, "enqueueWithTiming('chat' as any,"); 
  fs.writeFileSync(file, content);
}
