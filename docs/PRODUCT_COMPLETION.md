# Product Completion Matrix - API Platform Enterprise v5.0 (RC)

Esta matriz audita o estado atual da plataforma, mapeando o que está concluído (✅), o que está parcial (⚠️) e o que está incompleto (❌).
**Regra RC**: O desenvolvimento só focará em itens `Parcial` ou `Incompleto`.

| Item | Backend | Front | Status | Ações Necessárias |
|---|---|---|---|---|
| **Projects** | ✅ | ⚠️ | Parcial | Falta implementar o Wizard completo (Passos 1 a 11) no Frontend (`#/projects`), gerar IDs automáticos e conectar a interface de projetos à geração de URL/Runtime. |
| **Providers** | ✅ | ✅ | OK | Funcional (`#/providers`), com backend recebendo credenciais e capacidades. Apenas refinar design no frontend se necessário. |
| **API Keys** | ✅ | ✅ | OK | Geração com prefixos/hash, escopos, rate limit, funcionando no backend e na tela `#/keys`. |
| **Playground** | ✅ | ⚠️ | Parcial | O frontend `#/playground` possui mocks e botões não totalmente integrados. Precisa consumir a API Key recém gerada e disparar contra `/v1/text`, `/v1/image`, mostrando streaming real. |
| **Logs** | ✅ | ✅ | OK | Filtros na tela `#/logs` buscando requisições reais do Prisma. |
| **Health** | ✅ | ⚠️ | Parcial | Endpoint `/v1/health` ativo. A tela `#/health` apenas mostra JSON. Deve ser consolidada no Overview ou Dashboard do Projeto. |
| **Overview** | ✅ | ⚠️ | Parcial | `#/home` tem métricas reais do backend (`/admin/overview`), mas contém alguns mocks no layout para as métricas de CPU/RAM (usa dados simulados ou incompletos no frontend). |
| **Runtime** | ⚠️ | ❌ | Incompleto | A geração e vínculo de `runtimeId` por projeto/tenant e a integração com configs (Fenix/ICP) não está operando de ponta a ponta sem edição manual. |
| **Workers** | ✅ | ❌ | Incompleto | Back end de workers via BullMQ funciona. Não há tela dedicada isolada para monitorar filas específicas (`#/workers` ou `#/queues`), atualmente agrupado em Home. |
| **Storage / Imagens** | ⚠️ | ❌ | Incompleto | Storage persistente local mapeado, mas sem interface web de file browser ou buckets (`#/storage`). |
| **SDK** | ⚠️ | ❌ | Incompleto | Pacotes `sdk-ts`, `sdk-js` gerados, mas sem interface `#/sdk` explícita na criação do projeto para download direto das chaves. |
| **Tenants** | ✅ | ✅ | OK | Gestão de Tenants operante em `#/tenants` via `/admin/tenants`. |
| **Deploy** | ⚠️ | ❌ | Incompleto | Containerização pronta, mas falta automação (CI/CD, scripts de update automático, webhooks, tela com versão/commit na UI). |
| **Users** | ✅ | ✅ | OK | Admin via `#/users` funcional. |

---

## Mocks / TODOs / Issues a resolver:
- **`app.js:125` (home)**: Métricas como "0ms" ou "Workers: 0" hardcoded na primeira renderização antes do load de `/v1/health` e dados simulados no ping global da API (em `app.ts` gera delay artificial e valores fixos).
- **`app.ts:140`**: `const globalLatency = Math.floor(Math.random() * 20) + 20;` (Mock de latência que precisa ser substituído por métrica real).
- **`app.ts:104`**: `checks.workers = activeCount > 0 ? activeCount : 12; // Provide baseline for UI demo if idle` (Mock visual no health check, precisa refletir a verdade).
- **Fluxo de Projeto (`#/projects`)**: Falta interface para orquestrar os múltiplos providers e associar ao ProjectId novo gerado.
- **Deploy**: Falta criação do `update.sh` e `webhook` endpoint.
