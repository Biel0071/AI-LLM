# Smart Orchestrator

O Smart Orchestrator é o núcleo de roteamento inteligente da API-PLATFORM para payloads de texto e chat. Ele garante o balanço ideal entre custo, performance e estabilidade.

## Fluxo de Processamento

1. **Estimativa de Tokens**: Antes de enfileirar, os tokens são estimados usando uma heurística leve (4 chars por token, ou 3.5 para código).
2. **Super Comandos**: O orchestrator lê templates do banco (PromptTemplate) quando o usuário invoca um slug (ex: `/resumir`), aplicando injeção de sistema automaticamente.
3. **Routing**: O orchestrator filtra provedores pelo limite de janela de contexto e categoria de preço baseada no tamanho do payload.
4. **Execução & Critic**: Ao receber a resposta, avalia-se o tamanho e ocorrências de erro.
5. **Fallback & Truncate**: Em caso de falha (ex: HTTP 413, 429), realiza retry em cascata para provedores mais adequados ou maiores, incluindo truncate de emergência para prompts insanos (>80k tokens).

## Configuração

Ative o orquestrador no seu arquivo `.env`:

```env
ORCHESTRATOR_ENABLED=true
CRITIC_ENABLED=true
MAX_ESCALATIONS=2
```
