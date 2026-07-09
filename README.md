# AI Platform Enterprise

**AI Gateway centralizado** para Lovable, SaaS, CRM, ERP e aplicações multi-tenant.

Toda a comunicação segue o fluxo:

```
Lovable  →  AI Platform  →  Provider (Ollama, OpenAI, Gemini, Claude, ComfyUI...)  →  Resposta
```

O Lovable **nunca** acessa um provider diretamente. A plataforma centraliza autenticação, cache, filas, custos, observabilidade e multi-tenancy.

---

## Recursos

| Área | O que tem |
|---|---|
| **Providers** | Ollama, OpenAI, Gemini, Claude (SDK oficial Anthropic), OpenRouter, LM Studio, ComfyUI, Automatic1111, Stable Diffusion API, Replicate — todos plugáveis via Provider Pattern |
| **Capacidades** | Texto, chat, imagens (txt2img/img2img), upscale, remoção de fundo*, vision, embeddings, OCR, SEO, tradução, classificação |
| **Cache inteligente** | Mesmo prompt + modelo ⇒ nunca chama a IA novamente (Redis + Postgres, com hash, tokens e tempo) |
| **Filas** | BullMQ + Redis: prioridade, retry exponencial, dead-letter, concorrência configurável, agendamento |
| **Workers** | Texto, Imagem, Embedding, OCR (vision ou Tesseract), SEO, Tradução, Classificação |
| **Multi-tenant** | Cada loja tem API key, limites, provider padrão, histórico e custos próprios |
| **Dashboard** | Home, Providers, Modelos, Workers, Filas, Tokens & Custos, Cache, Logs, Usuários, API Keys, Health, Configurações |
| **Segurança** | API keys (hash SHA-256), JWT admin, Helmet, CORS, rate limit por chave, auditoria |
| **Observabilidade** | `/metrics` Prometheus, perfis opcionais Prometheus + Grafana no compose |
| **Docs** | Swagger/OpenAPI em `/docs`, documentação em `docs/` |
| **SDKs** | TypeScript, JavaScript (zero deps) e Python |

\* remoção de fundo/marca d'água e mockups usam ComfyUI/img2img — ver `docs/PROVIDERS.md`.

---

## Início rápido (Docker — recomendado)

```bash
# Windows (PowerShell)
powershell -ExecutionPolicy Bypass -File scripts/install.ps1

# Linux / macOS
bash scripts/install.sh

# VPS Ubuntu/Debian (instala Docker, gera segredos e sobe tudo)
bash scripts/deploy-vps.sh
```

Depois:

- **API**: http://localhost:3000 — Swagger em http://localhost:3000/docs
- **Dashboard**: http://localhost:8080 (login: `ADMIN_EMAIL` / `ADMIN_PASSWORD` do `.env`)
- **API key inicial**: `DEFAULT_API_KEY` do `.env` (header `x-api-key`)

> Local → VPS **sem alterar código**: apenas o `.env` muda.

## Desenvolvimento sem Docker

Requer Node.js 22, PostgreSQL e Redis locais.

```bash
npm install --workspaces --include-workspace-root
cp .env.example .env
npx prisma migrate dev --schema apps/api/prisma/schema.prisma
npm run dev:api      # API em watch mode
npm run dev:worker   # workers em watch mode
npm test             # testes (Vitest)
```

---

## Conectando o Lovable em menos de 5 minutos

```js
// 1. Cole o SDK (packages/sdk-js/index.js) ou chame direto via fetch:
const res = await fetch('https://SUA_PLATAFORMA/v1/text', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': 'ap_...' },
  body: JSON.stringify({ prompt: 'Crie a descrição de um tênis de corrida azul' }),
});
const data = await res.json();
// { success, provider, model, executionTime, tokens, cached, result: { text } }
```

Guia completo com exemplos de todos os endpoints: [`docs/LOVABLE.md`](docs/LOVABLE.md).

## Endpoints principais

| Método | Rota | Descrição |
|---|---|---|
| POST | `/v1/text` | Geração de texto (nome, descrição, SEO, anúncios...) |
| POST | `/v1/chat` | Chat multi-turno |
| POST | `/v1/image` | Geração de imagem (txt2img / img2img) |
| POST | `/v1/upscale` | Upscale de imagem |
| POST | `/v1/vision` | Análise de imagem |
| POST | `/v1/embed` | Embeddings |
| POST | `/v1/ocr` | OCR (vision ou Tesseract) |
| POST | `/v1/jobs` | Job assíncrono (seo, translation, classification...) |
| GET | `/v1/jobs/:id` | Status/resultado de um job |
| GET | `/v1/models` | Modelos disponíveis (por provider) |
| GET | `/v1/providers` | Providers + health |
| GET | `/v1/health` | Health da plataforma (público) |

**Resposta padrão** de todas as chamadas de IA:

```json
{
  "success": true,
  "provider": "ollama",
  "model": "llama3",
  "executionTime": 1240,
  "tokens": { "prompt": 12, "completion": 230, "total": 242 },
  "cached": false,
  "result": { "text": "..." }
}
```

---

## Estrutura

```
apps/
  api/         Fastify + Prisma + BullMQ (gateway REST)
  worker/      Workers de fila (texto, imagem, OCR, SEO, ...)
  dashboard/   Painel administrativo (SPA estática)
packages/
  shared/      Tipos, schemas Zod, providers, registry, cache-hash
  sdk-ts/      SDK TypeScript
  sdk-js/      SDK JavaScript (zero dependências)
  sdk-python/  SDK Python
docker/        Dockerfiles, nginx, prometheus
docs/          Arquitetura, API, providers, deploy, Lovable
scripts/       install.ps1 (Windows), install.sh, deploy-vps.sh
```

## Documentação

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — arquitetura, camadas e decisões
- [`docs/API.md`](docs/API.md) — referência de endpoints com exemplos
- [`docs/PROVIDERS.md`](docs/PROVIDERS.md) — configuração de cada provider
- [`docs/LOVABLE.md`](docs/LOVABLE.md) — integração Lovable passo a passo
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — VPS, Traefik/TLS, monitoramento

## Licença

MIT
