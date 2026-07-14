# Referência da API

Swagger interativo: `http://localhost:3000/docs`

## Autenticação

| Rotas | Método |
|---|---|
| `/v1/*` | Header `x-api-key: ap_...` (ou `Authorization: Bearer ap_...`) |
| `/admin/*` | `Authorization: Bearer <JWT>` obtido em `POST /admin/login` |
| `/v1/health`, `/metrics` | Público |

Campos comuns em todas as rotas de IA: `provider` (opcional), `model` (opcional),
`cache` (opcional, default `true`).

## Envelope padrão

```json
{
  "success": true,
  "provider": "ollama",
  "model": "llama3",
  "executionTime": 1240,
  "tokens": { "prompt": 12, "completion": 230, "total": 242 },
  "cached": false,
  "result": {}
}
```

Erros: `{ "success": false, "error": { "code": "...", "message": "..." } }`

---

## POST /v1/text

```bash
curl -X POST http://localhost:3000/v1/text \
  -H 'x-api-key: ap_...' -H 'content-type: application/json' \
  -d '{
    "prompt": "Crie a descricao de um tenis de corrida azul, 2 paragrafos",
    "system": "Voce e um copywriter de e-commerce",
    "provider": "ollama",
    "model": "llama3",
    "maxTokens": 500
  }'
```

`result: { "text": "..." }`

## POST /v1/chat

```bash
curl -X POST http://localhost:3000/v1/chat \
  -H 'x-api-key: ap_...' -H 'content-type: application/json' \
  -d '{
    "messages": [
      { "role": "system", "content": "Voce e um atendente de loja" },
      { "role": "user", "content": "Qual o prazo de entrega?" }
    ]
  }'
```

`result: { "message": { "role": "assistant", "content": "..." } }`

## POST /v1/image

```bash
curl -X POST http://localhost:3000/v1/image \
  -H 'x-api-key: ap_...' -H 'content-type: application/json' \
  -d '{
    "prompt": "product photography, blue running shoe, white background, studio light",
    "negativePrompt": "blurry, low quality",
    "width": 1024, "height": 1024, "steps": 20,
    "wait": true
  }'
```

- `wait: true` (default) → responde com `result: { images: [{ base64 | url }] }`.
- `wait: false` → responde `202 { jobId }`; consulte `GET /v1/jobs/:id`.
- `image` (base64) + `denoise` → img2img (melhorar imagem, produto humanizado, mockup).

## POST /v1/upscale

```json
{ "image": "<base64 ou URL>", "scale": 4 }
```

## POST /v1/vision

```json
{ "prompt": "Descreva este produto para o catalogo", "images": ["<base64 ou URL>"] }
```

## POST /v1/embed

```json
{ "input": ["tenis de corrida azul", "sapato social preto"] }
```

`result: { "embeddings": [[...], [...]] }`

## POST /v1/ocr

```json
{ "image": "<base64>", "language": "por" }
```

Engine configurável via `OCR_ENGINE` (`vision` = modelo multimodal; `tesseract` = binário).

## POST /v1/jobs — jobs assíncronos

```json
{ "type": "seo", "payload": { "product": "Tenis Runner X", "language": "pt-BR" }, "priority": 3 }
```

Tipos: `text`, `image`, `embedding`, `ocr`, `seo`, `translation`, `classification`.

- `seo` → `{ name, title, description, metaDescription, slug, category, tags, summary, adCopy }`
- `translation` → `{ text, targetLanguage, sourceLanguage? }`
- `classification` → `{ text, categories: [...] }` ⇒ `result: { category }`

## GET /v1/jobs/:id

`{ success, jobId, status: waiting|active|completed|failed, result, error }`

## GET /v1/models · GET /v1/providers · GET /v1/health

Listagem dinâmica de modelos por provider, health de todos os providers e health da
plataforma (banco, redis, uptime).

## ComfyUI (extras)

- `GET /v1/comfyui/queue` — fila do ComfyUI
- `GET /v1/comfyui/progress/:promptId` — progresso de uma geração
- `POST /v1/comfyui/cancel` — cancela geração (`{ promptId? }`)

---

## Admin (`/admin`, JWT)

| Rota | Descrição |
|---|---|
| `POST /admin/login` | `{ email, password }` → `{ token }` |
| `GET /admin/overview` | Contadores, uso 24h, filas, cache |
| `GET /admin/providers` | Health + modelos de todos os providers |
| `GET/POST /admin/tenants` | Lojas/tenants |
| `GET/POST/DELETE /admin/api-keys` | Gestão de chaves (a chave completa só aparece na criação) |
| `GET/POST /admin/users` | Usuários do painel |
| `GET /admin/logs` | Logs de requisições (`?limit&provider&capability`) |
| `GET /admin/usage` | Uso/custos agregados por dia (`?days=30`) |
| `GET /admin/queues` · `GET /admin/jobs` | Filas e jobs |
| `GET /admin/workers` | Workers online (heartbeat) |
| `GET/DELETE /admin/cache` | Estatísticas / limpeza do cache |
| `GET/POST /admin/models` | Custos por modelo (para cálculo de custo por request) |
| `GET /admin/audit` | Trilha de auditoria |

## Forçar um provider específico

Não existe uma rota separada por provider — todo endpoint em `/v1/*` já aceita
`provider` (nome exato, ex. `"ollama"`, `"comfyui"`) e `fallback: false` para
desabilitar o roteamento resiliente e exigir aquele provider especificamente:

```json
{ "prompt": "...", "provider": "ollama", "fallback": false }
```

Sem `provider`, a plataforma tenta o default da capacidade e cai para os
próximos da `FREE_PROVIDER_ORDER` em caso de falha. ComfyUI offline retorna
`503 COMFYUI_OFFLINE`/`fetch failed` normalmente.

### Gateway universal

- `POST /v1/chat`
- `POST /v1/image`
- `POST /v1/video`
- `POST /v1/workflow`
- `POST /v1/vision`
- `POST /v1/embedding`
- `POST /v1/audio` — responde `501` até existir um provider de áudio configurado.

```bash
curl -X POST "$AI_PLATFORM_URL/v1/chat" \
  -H "content-type: application/json" \
  -H "x-api-key: $AI_PLATFORM_API_KEY" \
  -d '{"messages":[{"role":"user","content":"Olá"}],"provider":"ollama"}'
```

```ts
const response = await fetch(`${AI_PLATFORM_URL}/v1/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': AI_PLATFORM_API_KEY },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'Olá' }] }),
});
```

### Supabase Edge Function / Lovable

Armazene a chave em `AI_PLATFORM_API_KEY` nos secrets do projeto, nunca no frontend público.

```ts
Deno.serve(async (req) => fetch(`${Deno.env.get('AI_PLATFORM_URL')}/v1/chat`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': Deno.env.get('AI_PLATFORM_API_KEY')! },
  body: await req.text(),
}));
```
## Carga alta e requisicao reversa

`POST /v1/text` aceita `execution`:

- `auto` (padrao): responde normalmente quando existe capacidade sincrona; durante pico responde HTTP 202 com `jobId` e transfere o trabalho para BullMQ.
- `async`: sempre responde 202 imediatamente.
- `sync`: nunca fica aguardando memoria; se o slot estiver ocupado responde 429.

Jobs individuais, lotes e texto assincrono aceitam callback:

```json
{
  "type": "seo",
  "payload": { "product": "Tenis Runner", "cache": true },
  "callback": {
    "url": "https://seu-sistema.com/api/ai/callback",
    "secret": "segredo-com-no-minimo-16-caracteres"
  }
}
```

A entrega reversa ocorre em uma fila `webhook` separada, com 5 tentativas e backoff exponencial. O header `x-ai-platform-event` vale `job.completed` ou `job.failed`. Valide `x-ai-platform-signature`, calculado como `sha256=HMAC_SHA256(secret, corpo_raw)`, antes de aplicar o resultado. A URL deve usar HTTPS e nao pode resolver para rede privada. Para integracao interna deliberada, `WEBHOOK_ALLOW_HTTP=true` libera HTTP, mas enderecos privados continuam bloqueados.

Para populacoes de ate 10.000 itens, envie uma unica chamada a `/v1/jobs/batch`, inclua um callback em cada item e nao mantenha conexoes HTTP abertas. O sistema deduplica jobs equivalentes, processa na velocidade sustentavel da maquina e devolve cada conclusao ao sistema de origem.
### Estado operacional da populacao

Toda rota assincrona retorna imediatamente `populationStatus: "populating"` e uma mensagem informando que a demanda foi organizada sem bloquear a aplicacao. Use `POST /v1/jobs/status` para acompanhar um lote; a resposta inclui `counts`, `progressPercent`, `uniqueJobs`, `duplicateReferences`, aceitos e rejeitados. Use `GET /v1/jobs/stats` para o estado global (`idle` ou `populating`), quantidade aguardando/ativa, `estimatedDrainMs` e `estimatedFinishAt`.

O frontend deve exibir `message` diretamente e parar o acompanhamento quando o status for `completed`, `completed_with_errors` ou `failed`.