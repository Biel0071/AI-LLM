# AI Platform SDK (JavaScript)

Zero dependências — funciona em Node 18+, browsers e apps Lovable.
Basta copiar `index.js` para o seu projeto (ou instalar via workspace).

```js
import { AIPlatform } from '@ai-platform/sdk-js';

const ai = new AIPlatform({ baseUrl: 'http://localhost:3000', apiKey: 'ap_...' });

const { result } = await ai.text({ prompt: 'Descreva um tenis de corrida azul' });
console.log(result.text);
```

Métodos: `text`, `chat`, `image`, `upscale`, `vision`, `embed`, `ocr`,
`createJob`, `getJob`, `waitJob`, `models`, `providers`, `health`.
