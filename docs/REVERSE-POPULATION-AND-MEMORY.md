# População reversa e memória operacional

## O que foi implementado

A AI Platform agora suporta os dois sentidos da integração:

1. **Entrada normal (push):** o projeto chama `POST /v1/jobs/batch`.
2. **Entrada reversa (pull):** a AI Platform chama periodicamente o sistema de origem, pergunta se existe trabalho e enfileira o lote retornado.
3. **Retorno (callback):** ao concluir ou falhar, a fila `webhook` envia o resultado assinado ao `resultUrl` do conector.

O poller nunca chama um LLM para decidir se deve buscar trabalho. Ele usa capacidade real das filas, locks Redis e limites determinísticos, portanto não gasta tokens e não cria loops.

## Criar um conector

```http
POST /v1/reverse/connectors
x-api-key: ap_live_...
content-type: application/json

{
  "name": "catalogo-lovable",
  "sourceUrl": "https://seu-projeto.com/api/ai/pending",
  "resultUrl": "https://seu-projeto.com/api/ai/result",
  "secret": "troque-por-um-segredo-forte-de-32-caracteres",
  "intervalSeconds": 30,
  "batchSize": 20,
  "enabled": true
}
```

A chave precisa do escopo `workflow`. O segredo é criptografado no PostgreSQL e nunca aparece em respostas da API.

Rotas adicionais:

- `GET /v1/reverse/connectors`
- `PATCH /v1/reverse/connectors/:id`
- `DELETE /v1/reverse/connectors/:id`
- `POST /v1/reverse/connectors/:id/poll` para teste manual

## Contrato do sourceUrl

A plataforma envia `POST` com:

```json
{
  "event": "population.requested",
  "connectorId": "...",
  "cursor": "cursor-anterior",
  "limit": 20,
  "capacity": {
    "available": 997,
    "queues": []
  },
  "timestamp": "2026-07-20T20:00:00.000Z"
}
```

Headers importantes:

- `x-ai-platform-event: population.requested`
- `x-ai-platform-signature: sha256=<HMAC_SHA256(secret, corpo_raw)>`

O sistema de origem responde:

```json
{
  "cursor": "pagina-42",
  "hasMore": false,
  "jobs": [
    {
      "sourceJobId": "produto-123-descricao-v1",
      "type": "seo",
      "priority": 5,
      "payload": {
        "product": "Tênis Runner Azul",
        "description": "Tênis leve para corrida",
        "cache": true
      }
    }
  ]
}
```

`sourceJobId` deve ser estável. Se a origem repetir o mesmo item, a deduplicação impede processamento duplicado. Tipos recursivos como `webhook` e `reverse` não são aceitos.

Se `REVERSE_REQUIRE_RESPONSE_SIGNATURE=true`, a origem também deve assinar o corpo bruto da resposta no header `x-ai-platform-signature`.

## Contrato do resultUrl

O callback existente envia `job.completed` ou `job.failed`, com HMAC e correlação completa:

```json
{
  "event": "job.completed",
  "jobId": "...",
  "queue": "seo",
  "status": "completed",
  "origin": {
    "connectorId": "...",
    "sourceJobId": "produto-123-descricao-v1",
    "depth": 1
  },
  "result": {},
  "provider": "ollama",
  "model": "qwen2.5:1.5b"
}
```

O callback possui cinco tentativas com backoff exponencial. O poller também aplica backoff exponencial quando a origem fica indisponível.

## Memória operacional

A memória aprende por tenant/projeto e por contexto de execução:

- tipo da fila e tarefa;
- tamanho aproximado da entrada;
- presença de imagem/vídeo;
- resolução e tamanho do lote;
- provider/modelo utilizado;
- qualidade, sucesso, falha e duração.

Ela **não armazena o texto do prompt nem o conteúdo de imagens**. Após pelo menos três sucessos com qualidade mínima 90, pode reutilizar a rota comprovadamente mais confiável e rápida. Uma rota aprendida que falha perde confiança automaticamente.

Consultar memória:

```http
GET /v1/memory/stats
x-api-key: ap_live_...
```

Enviar feedback de qualidade:

```http
POST /v1/memory/feedback
x-api-key: ap_live_...
content-type: application/json

{ "jobId": "...", "accepted": true }
```

Feedback rejeitado reduz a confiança da rota. Memórias nunca são compartilhadas entre tenants ou projetos.

## Prompt para integrar no Lovable

```text
Implemente duas Edge Functions seguras para integrar com a AI Platform.

1. POST /api/ai/pending:
- leia o corpo bruto;
- valide x-ai-platform-signature com HMAC-SHA256 e AI_PLATFORM_REVERSE_SECRET;
- use cursor e limit recebidos;
- busque itens pendentes no banco com lock/claim transacional;
- responda {cursor, hasMore, jobs};
- cada job deve ter sourceJobId estável, type permitido e payload;
- nunca devolva o mesmo item como pendente depois de confirmado/concluído.

2. POST /api/ai/result:
- valide a assinatura HMAC sobre o corpo bruto;
- localize o item por body.origin.sourceJobId;
- em job.completed salve body.result e marque concluído;
- em job.failed salve body.error e marque falha recuperável;
- torne a operação idempotente por body.jobId + body.event;
- responda HTTP 2xx somente depois do commit no banco.

Use secrets do servidor, nunca exponha AI_PLATFORM_REVERSE_SECRET no frontend.
Não faça polling no navegador. A AI Platform controla a população e os callbacks.
```
