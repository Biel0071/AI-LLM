# Known Issues — API Platform

Inventário de dívidas encontradas na investigação de hardening (2026-07-29).
Prioridade: P1 = afeta produção agora · P2 = risco real · P3 = cosmético/futuro.
Nada aqui foi corrigido ainda — é o mapa, não o histórico.

## Bloqueador de processo (resolver antes de estabilizar)

- **Working tree com ~70 arquivos não commitados.** Duas refatorações em curso e
  não commitadas: dashboard sendo migrado de vanilla JS (`apps/dashboard/public/app.js`)
  para Vite/Tailwind (`apps/dashboard/src/`, `vite.config.ts`); SDK Python sendo
  renomeado (`ai_platform/` deletado → `api_platform/` novo). Feature Mission/Scheduler
  parcial (`mission.provider.ts`, `registries.ts`, `secrets.ts` sem commit).
  **Impacto:** impossível estabilizar sobre baseline instável sem colidir com trabalho
  em andamento. **Ação:** organizar/commitar ou descartar antes do hardening.
- **Sem Node.js utilizável nesta máquina de dev.** Não roda `npm test`/`tsc` local.
  Testes só validam no build Docker ou na VPS. **Impacto:** a regra "executar teste /
  provar" depende de rodar na VPS ou em CI.

## P1 — mock no caminho crítico

- **`mockMetrics` decide roteamento de provider E alimenta métrica Prometheus.**
  `packages/shared/src/providers/registry.ts:23` — latência/health/custo **hardcoded**
  por provider. `calculateScore` (linha 87) usa esses valores fixos para:
  1. ordenar candidatos de fallback (`resolveCandidates`, linha 176 → `resolve` linha 158);
  2. ser exportado como `providerScore` em `apps/api/src/services/ai.service.ts:155`.
  **Impacto real:** o dashboard mostra saúde/latência **fictícias** como se fossem
  medidas; um provider real lento/instável pode ser escolhido na frente porque o mock
  diz que é rápido/saudável. O próprio comentário admite "Mock inicial... seria mantido
  num Redis". **Zero testes** cobrem `calculateScore`.
  **Causa raiz:** métricas reais (do circuit breaker / RequestLog / health real) nunca
  foram ligadas ao score; o mock ficou como placeholder permanente.

## P2 — dívida real

- **Stream parsing não implementado no provider OpenAI-compatível.**
  `packages/shared/src/providers/openai-compatible.provider.ts:107` — `// TODO: Implement
  stream parsing if needed, currently assumes simple json return`. Afeta streaming SSE
  (que a missão text-core queria). Hoje assume resposta JSON simples.
- **Upload multipart placeholder no OpenAI-compatível.**
  Mesmo arquivo, linha ~171 — `// This is a placeholder for the actual
  multipart/form-data logic`. Verificar se algum endpoint depende disso.

## Falsos-positivos (verificados, NÃO são dívida)

- `apps/worker/src/processors.ts:294` — "Extraia TODO o texto" é instrução de prompt OCR.
- `apps/worker/src/processors.ts:162` — "Placeholder 1x1" é comentário de imagem de
  entrada, comportamento intencional e documentado.
- `apps/dashboard/public/app.js` — vários `placeholder=` são atributos HTML de inputs;
  "mockup" é label de categoria de imagem. Nenhum é mock de lógica.

## Verificado nesta sessão (estável, com evidência)

- TLS `.22 → .215` via Caddy:8443, cert LE válido, isolado por IP em 2 camadas,
  sobrevive a reboot (ver `DEPLOY-STATUS.md`).
- Porta 3000 só em loopback; firewalld + DOCKER-USER isolam o acesso.
- `health()` do Ollama faz inferência real (não só `/api/tags`).
