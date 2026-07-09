# AI Platform SDK (TypeScript)

```bash
npm run build -w packages/sdk-ts
```

```ts
import { AIPlatform } from '@ai-platform/sdk';

const ai = new AIPlatform({ baseUrl: 'http://localhost:3000', apiKey: 'ap_...' });

const text = await ai.text({ prompt: 'Descreva um tenis de corrida azul' });
console.log(text.result.text);

const img = await ai.image({ prompt: 'product photography, white background' });
console.log(img.result.images[0].base64?.slice(0, 40));

const job = await ai.createJob({ type: 'translation', payload: { text: 'Hello', targetLanguage: 'pt-BR' } });
const done = await ai.waitJob(job.jobId);
```

Tipado de ponta a ponta; todas as respostas seguem `StandardResponse<T>`.
