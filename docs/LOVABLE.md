# Integração Lovable (menos de 5 minutos)

## 1. Pegue sua API key

Use o valor de `DEFAULT_API_KEY` do `.env`, ou gere uma nova no dashboard
(**API Keys → Gerar chave**).

## 2. Configure no Lovable

Crie uma variável de ambiente/secret no seu projeto Lovable:

```
AI_PLATFORM_URL=https://sua-plataforma.com   (ou http://localhost:3000)
AI_PLATFORM_KEY=ap_...
```

## 3. Chame a plataforma

### Opção A — fetch direto (nenhuma dependência)

```ts
async function ai(path: string, body: unknown) {
  const res = await fetch(`${import.meta.env.AI_PLATFORM_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': import.meta.env.AI_PLATFORM_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error?.message);
  return data;
}
```

### Opção B — SDK JavaScript (copie `packages/sdk-js/index.js` para o projeto)

```ts
import { AIPlatform } from './ai-platform-sdk';

const ai = new AIPlatform({
  baseUrl: import.meta.env.AI_PLATFORM_URL,
  apiKey: import.meta.env.AI_PLATFORM_KEY,
});
```

## 4. Receitas prontas

### Descrição de produto

```ts
const { result } = await ai.text({
  system: 'Voce e um copywriter de e-commerce brasileiro.',
  prompt: `Crie uma descricao vendedora para: ${produto.nome}. Caracteristicas: ${produto.specs}`,
});
produto.descricao = result.text;
```

### Descrição a partir da FOTO real do produto (não só do nome)

Duas chamadas: visão (modelo pequeno, só funciona bem com instrução
simples em inglês) + texto (modelo bom em português). NÃO peça pro
`ai.vision` gerar copy de venda direto em português com instrução longa
- ele falha silenciosamente (retorna texto vazio) nesse caso.

```ts
const { result: analise } = await ai.vision({
  prompt: 'Describe this product image in detail: color, material, style, shape.',
  images: [fotoBase64],
});

const { result } = await ai.text({
  prompt: `Com base nesta descricao visual: "${analise.text}", escreva um texto de venda persuasivo em portugues para o produto "${produto.nome}".`,
});
produto.descricao = result.text;
```

### Pacote SEO completo (nome, título, meta, slug, categoria, tags)

```ts
const { jobId } = await ai.createJob({
  type: 'seo',
  payload: { product: produto.nome, description: produto.specs, language: 'pt-BR' },
});
const job = await ai.waitJob(jobId);
// job.result.result => { name, title, description, metaDescription, slug, category, tags, summary, adCopy }
```

### Foto de catálogo (fundo branco)

```ts
const { result } = await ai.image({
  prompt: `professional product photography, ${produto.nome}, pure white background, studio lighting, 8k`,
  negativePrompt: 'blurry, watermark, text, low quality',
  // 512x512 (nao passe width/height maior sem necessidade): na VPS sem
  // GPU, cada pixel a mais custa tempo real - 1024x1024 pode levar varios
  // minutos. O default de 512x512 (quando nao informado) ja fica na
  // faixa de ~1min por imagem.
});
const imagemBase64 = result.images[0].base64;
```

### Catálogo inteiro em lote (fila, não bloqueia)

Pra subir um catálogo com várias fotos, use `createJob` (fila BullMQ) em
vez de `ai.image` direto - a chamada retorna na hora com um `jobId`, e o
worker processa uma imagem de cada vez em background (a VPS não tem GPU,
então rodar várias imagens "ao mesmo tempo" só criaria fila falsa e
estouraria timeout). Cada produto vira 1 job:

```ts
const jobs = await Promise.all(
  produtos.map((p) =>
    ai.createJob({
      type: 'image',
      payload: { prompt: `professional product photo, ${p.nome}, white background` },
    }),
  ),
);
// Guarde jobs[i].jobId por produto e va consultando status depois -
// nao precisa (nem deve) esperar tudo terminar antes de responder ao
// usuario. GET /v1/jobs/:id (ou ai.waitJob(jobId) se quiser bloquear
// um item especifico) devolve o status/resultado.
```

O sistema roda 24h na VPS (containers com `restart: unless-stopped` +
Docker habilitado no boot) - se cair por qualquer motivo, sobe sozinho e
a fila retoma os jobs pendentes de onde parou (Redis/Postgres persistem
em volumes).

### Melhorar foto enviada pelo lojista / gerar "outras posições" (img2img)

```ts
const { result } = await ai.image({
  prompt: 'professional product photo, clean background, different angle, high quality',
  image: fotoBase64,     // foto original
  denoise: 0.3,          // 0.2-0.3 preserva bem o produto real; 0.4-0.5 permite mais variacao
});
```

Isso NÃO gera ângulo de câmera 3D real a partir de 1 foto (precisaria de
um modelo adicional pesado, inviável sem GPU) - o que faz é variar
fundo/luz/enquadramento mantendo o produto reconhecível, o que já cobre
bem "fotos similares" de catálogo.

### Upscale para zoom do catálogo

```ts
const { result } = await ai.upscale({ image: fotoBase64, scale: 4 });
```

### Ler etiqueta/nota fiscal (OCR)

```ts
const { result } = await ai.ocr({ image: fotoBase64, language: 'por' });
```

### Classificar avaliação de cliente

```ts
const { jobId } = await ai.createJob({
  type: 'classification',
  payload: { text: avaliacao, categories: ['positiva', 'negativa', 'neutra'] },
});
```

### Chat de atendimento

```ts
const { result } = await ai.chat({
  messages: [
    { role: 'system', content: `Voce e o atendente da loja ${loja.nome}. Politicas: ${loja.politicas}` },
    ...historico,
    { role: 'user', content: mensagemDoCliente },
  ],
});
```

## 5. Boas práticas

- **Cache é automático**: o mesmo prompt nunca é cobrado duas vezes (`cached: true`, custo zero).
- Prefira `wait: false` + `waitJob` para imagens em lote (não bloqueia a UI).
- Escolha provider/modelo por request quando precisar: `{ provider: 'openai', model: 'gpt-4o-mini' }`.
- Monitore custos por loja no dashboard (**Tokens & Custos**).
