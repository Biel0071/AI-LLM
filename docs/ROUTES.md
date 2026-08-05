# Frontend Hash Routes Inventory (Dashboard SPA)

Este arquivo mapeia todas as rotas (Hash Routes) existentes em `apps/dashboard/public/app.js`.

## Rotas Atuais (window.location.hash)

| Hash Route | Função Handler (`pages.xxx`) | Descrição e Estado |
|---|---|---|
| `#/home` | `home()` | Visão geral, latência, métricas de tokens, providers realtime. (Possui mocks/dados estáticos parciais para workers e memory). |
| `#/projects` | `projects()` | (Em desenvolvimento / Incompleto). Mapeia para a página de gestão de projetos multi-tenant. |
| `#/providers` | `providers()` | Lista e edita provedores, keys, urls base. |
| `#/keys` | `keys()` | Gestão de API Keys, rate limits e associações de Tenant. |
| `#/playground` | `playground()` | Interações com a API para chat, texto e imagem. (Precisa integrar fetch robusto usando chaves reais por projeto). |
| `#/mission` | `mission()` | Viewer visual estilo radar. |
| `#/logs` | `logs()` | Interface para buscar RequestLogs. |
| `#/health` | `health()` | Realtime fetch para `/v1/health`. |
| `#/metrics` | `metrics()` | Prometheus metrics proxy. |
| `#/icp` | `icp()` | Proxy manager e integrações de domínio ICP. |
| `#/runtime` ou `#/fenix` | `fenix()` | Sincronização runtime string com FÊNIX OS. |
| `#/tenants` | `settings()` (Mapeado) | Criação e listagem de Tenants (Lojas). |
| `#/users` | `users()` | Gestão de administradores. |
| `#/settings` | `settings()` | Documentação, tenant defaults e configurações globais. |
| `#/security` | `security()` | Painel de controle estático listando políticas ativas. |
| `#/backup` | `backup()` | Comandos sugeridos para backup de BD, Redis e arquivos. |

## Rotas Faltantes (Orfãs ou Necessárias)
- `#/models` -> Não implementado explicitamente (parte do `providers()`).
- `#/capabilities` -> Não isolado (agrupado em `providers()`).
- `#/workers` -> Não isolado (parcialmente na `home()`).
- `#/queues` -> Não isolado (parcialmente na `home()`).
- `#/storage` -> Não implementado.
- `#/buckets` -> Não implementado.
- `#/sdk` -> Embebido na documentação, mas requer tela dedicada.
- `#/documentation` -> Link externo `/docs` (Swagger).
