# Integração Lovable — AI Platform Production

## Endpoints reais

- API base atual: `http://209.50.241.22:3000`
- Health público: `GET /v1/health`
- Texto: `POST /v1/text`
- Imagem assíncrona: `POST /v1/image`
- População em lote: `POST /v1/jobs/batch`
- Status em lote: `POST /v1/jobs/status`
- Status individual: `GET /v1/jobs/:id`
- Estatísticas das filas: `GET /v1/jobs/stats`

A chave nunca deve ser colocada em `VITE_*`, no JavaScript do navegador ou commitada. Cadastre-a como secret server-side `AI_PLATFORM_API_KEY` no Lovable Cloud/Supabase e faça as chamadas por Edge Function.

## Prompt para colar no Lovable

```text
Integre este projeto à AI Platform de produção usando uma Edge Function server-side.

Secrets obrigatórios:
AI_PLATFORM_BASE_URL=http://209.50.241.22:3000
AI_PLATFORM_API_KEY=<colar a chave live fornecida separadamente>

Nunca exponha AI_PLATFORM_API_KEY no frontend, localStorage, logs ou respostas HTTP.

Crie uma Edge Function `ai-platform` que:
1. aceite somente usuários autenticados;
2. valide os campos recebidos;
3. envie `x-api-key: Deno.env.get("AI_PLATFORM_API_KEY")`;
4. aplique timeout de 30s nas operações síncronas;
5. para imagens e lotes, use modo assíncrono e devolva o jobId imediatamente;
6. consulte `/v1/jobs/:id` ou `/v1/jobs/status` a cada 2 segundos, com backoff até 10 segundos;
7. pare o polling em completed ou failed;
8. nunca repita automaticamente um POST que já retornou jobId.
9. aceite picos de 20-30 pedidos sem bloquear a UI: cada POST deve ser feito uma unica vez e o jobId salvo;
10. mostre posicao, jobs a frente e ETA usando response.queue e atualize pelo GET /v1/jobs/:id;
11. use GET /v1/jobs/stats para exibir queued, concurrency e estimatedDrainMs;
12. trate estimatedWaitMs como estimativa, nunca como SLA, pois prioridade e retries podem alterar a ordem.

Texto:
POST /v1/text
Body: { "prompt": string, "task": "general" | "quality", "cache": true }

Imagem:
POST /v1/image
Body: { "prompt": string, "negativePrompt": string opcional, "provider": "auto", "model": "auto", "wait": false }
Resposta esperada: { "success": true, "jobId": string, "status": "waiting", "queue": { "position": number, "jobsAhead": number, "concurrency": 1, "estimatedWaitMs": number, "estimatedFinishAt": ISODate, "approximate": true } }

Para população de catálogo gere uma imagem por produto. Se usar `POST /v1/image-gallery`, envie explicitamente `"count": 1`; não use uma imagem transparente 1x1 como placeholder. Quando não houver foto de origem, use `POST /v1/image` somente com prompt.

População de catálogo em lote:
POST /v1/jobs/batch
Body:
{
  "jobs": produtos.map(produto => ({
    "type": "seo",
    "priority": 5,
    "payload": {
      "product": produto.nome,
      "description": produto.descricao,
      "language": "pt-BR",
      "provider": "auto",
      "cache": true
    }
  }))
}

Divida lotes acima de 1000 itens. Salve jobIds no banco vinculados ao registro de origem. Crie uma tela de progresso usando `/v1/jobs/status`, com contadores waiting, active, completed e failed. Permita retentar somente jobs failed e preserve os IDs concluídos. Para imagens, mostre o arquivo retornado em `result.images[].url` quando completed.
```

## Teste rápido server-side

```bash
curl -X POST "$AI_PLATFORM_BASE_URL/v1/text" \
  -H "x-api-key: $AI_PLATFORM_API_KEY" \
  -H "content-type: application/json" \
  -d '{"prompt":"Responda somente INTEGRACAO-OK","cache":false}'
```

Para produção web HTTPS, publique a API atrás de um domínio com TLS. Enquanto isso, o endereço IP HTTP deve ser consumido apenas por função server-side, nunca diretamente pelo navegador HTTPS.