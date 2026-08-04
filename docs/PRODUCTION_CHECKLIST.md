# Production Checklist — API Platform

Estado de prontidão para produção Enterprise. `[x]` = feito com evidência ·
`[~]` = parcial · `[ ]` = pendente. Não marcar `[x]` sem prova medida.

## Segurança / Rede

- [x] Chave de API não trafega em claro — TLS `.22 → .215` (Caddy:8443, cert LE válido).
      Prova: `curl https://` sem `-k` = 200; HTTP `:3000` externo = 000. (`DEPLOY-STATUS.md`)
- [x] Gateway não exposto na internet — 3000 só em loopback; 8443 restrito à `.22`
      (firewalld rich rule + Caddy remote_ip). Prova: scan externo = 000.
- [x] Postgres/Redis não expostos — bind `127.0.0.1`. Prova: ausentes no `ss` público.
- [x] `/docs` desligável em produção (`DOCS_ENABLED`); `/metrics` com token (`METRICS_TOKEN`).
- [x] Isolamento sobrevive a reboot — provado com reboot real (boot 16:22, `.22`=200, PC=000).
- [ ] Renovação automática do cert LE (expira 2026-10-27) — certbot renew + reload Caddy
      NÃO agendado. Ver `DEPLOY-STATUS.md` pendências.
- [ ] Rotacionar `POSTGRES_PASSWORD` (`aiplatform:aiplatform`) — parametrizado no compose,
      rotação real adiada por decisão (não exposto à internet).

## Estabilização de código (MODO PRODUCT HARDENING)

- [ ] Eliminar `mockMetrics` do registry — substituir por métricas reais (P1, `KNOWN_ISSUES.md`).
- [ ] Testar `calculateScore` — hoje sem cobertura.
- [ ] Stream parsing no provider OpenAI-compatível (P2).
- [ ] Multipart upload no provider OpenAI-compatível (P2, confirmar se usado).
- [ ] Working tree limpo (baseline) — ~70 arquivos não commitados bloqueiam o hardening.

## Infra / Deploy

- [x] Deploy auto-escala por hardware (tier lite/power). Prova: `.215` detectada power.
- [x] Deploy fecha o ciclo sozinho ("Deploy concluido" sob `set -e`).
- [x] Watchdog reaplica firewall no boot (janela de exposição = 0s, medida).
- [~] Caddy/cert TLS não estão no `deploy-vps.sh` — feitos à mão; Caddyfile versionado
      em `docker/tls/`, mas redeploy limpo não recria. Automação pendente.

## Não verificado (nomeado, não encenado)

- Queue/worker/redis/postgres sob carga concorrente real — só smoke tests individuais.
- Dashboard novo (Vite) — migração inacabada, não testado.
- SDKs (js/ts/python) — SDK Python em meio a renomeação; não validados nesta sessão.
- CI (`​.github/workflows/ci.yml`) — modificado, não commitado; não sei se passa.
