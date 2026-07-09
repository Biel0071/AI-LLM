# Arquitetura

## Visão geral

```
                       ┌─────────────────────────────────────────────┐
                       │                 AI PLATFORM                 │
 Lovable / SaaS ──────▶│  Fastify API ── Auth ── Rate limit ── Zod   │
 (x-api-key)           │        │                                    │
                       │        ├─▶ Cache Service (Redis + Postgres) │
                       │        ├─▶ AI Service ──▶ Provider Registry │
                       │        │                   │                │
                       │        └─▶ Queue Service   │                │
                       │              (BullMQ)      ▼                │
                       │        ┌──────────┐   Providers:            │
                       │        │ Workers  │   ollama openai gemini  │
                       │        │ txt img  │──▶claude openrouter     │
                       │        │ ocr seo  │   lmstudio comfyui      │
                       │        │ ...      │   a1111 sdapi replicate │
                       │        └──────────┘                         │
                       │  Postgres (Prisma)  Redis  Prometheus       │
                       └─────────────────────────────────────────────┘
```

## Camadas (Clean Architecture)

| Camada | Onde | Responsabilidade |
|---|---|---|
| **Domain** | `packages/shared/src/types.ts` | Contratos: `AIProvider`, `StandardResponse`, erros |
| **Application** | `apps/api/src/services/*` | Orquestração: cache → provider → usage → envelope |
| **Infrastructure** | `packages/shared/src/providers/*`, `apps/api/src/lib/*` | Providers HTTP, Prisma, Redis, BullMQ |
| **Interface** | `apps/api/src/routes/*`, dashboard, SDKs | REST, painel, clientes |

## Padrões aplicados

- **Provider Pattern** — todo provider implementa a interface `AIProvider`
  (`generateText`, `chat`, `generateImage`, `upscale`, `embed`, `vision`, `health`, `models`).
  Providers OpenAI-compatíveis (OpenAI, OpenRouter, LM Studio) herdam de
  `OpenAICompatibleProvider`; cada um é independente e registrado só se configurado.
- **Repository/Service Layer** — Prisma encapsulado em serviços (`cache`, `usage`, `queue`).
- **Dependency Injection** — providers recebem config no construtor (nada lê `process.env`
  dentro do provider); o registry é montado por `createRegistryFromEnv`.
- **Event-driven / Worker Queue** — BullMQ com fila por domínio
  (`text`, `image`, `embedding`, `ocr`, `seo`, `translation`, `classification`),
  retry exponencial (3 tentativas), dead-letter (falhas ficam persistidas) e prioridade 1–10.
- **Envelope padrão** — toda resposta de IA segue
  `{ success, provider, model, executionTime, tokens, cached, result }`.

## Fluxo de uma requisição `/v1/text`

1. `requireApiKey` valida a chave (hash SHA-256, cache Redis 60s) e resolve o tenant.
2. Rate limit por chave (Redis).
3. Zod valida o payload.
4. `execute()`:
   - resolve provider (`request.provider` → default do env → primeiro compatível);
   - calcula `cacheKey = sha256(canonical({capability, provider, model, input}))`;
   - **cache hit** → responde com `cached: true` e `executionTime: 0`;
   - **cache miss** → chama o provider, mede tempo, registra métricas Prometheus,
     grava `RequestLog` + agregado diário `Usage` (com custo via `ModelConfig`),
     persiste no cache (Redis TTL + Postgres) e envelopa.

## Fluxo assíncrono (filas)

1. `POST /v1/image { wait:false }` ou `POST /v1/jobs` cria registro `Job` (Postgres) e
   enfileira no BullMQ com o mesmo id.
2. O worker consome, marca `active` → executa o processor → `completed`/`failed`
   com resultado/erro persistidos.
3. Cliente consulta `GET /v1/jobs/:id` (ou usa `waitJob` dos SDKs).
4. Workers publicam heartbeat a cada 30s (`WorkerNode`), exibido no dashboard.

## Multi-tenant

`Tenant` (loja) → possui `ApiKey`s, limites, providers padrão, `Usage` diário, custos e
histórico (`RequestLog`, `Job`, `Image`). A API key identifica o tenant em cada request.

## Escalabilidade

- API e workers são stateless → escale horizontalmente (`docker compose up --scale worker=4`).
- Redis compartilha cache/filas entre instâncias.
- Postgres é a única fonte de verdade para dados de negócio.
- Métricas por provider/capacidade permitem autoscaling informado.
