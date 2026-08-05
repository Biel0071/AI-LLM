# Deploy Enterprise & CI/CD - API Platform Enterprise v5.0

## Política "VPS First"
O ambiente local (localhost) de desenvolvimento não é considerado a referência final de estabilidade. O ambiente de produção na VPS (Docker, Nginx real, Rede bridge, Certbot) dita a arquitetura final.

## Ciclo de Deploy Automático (Continuous Deployment)

O sistema suportará a atualização baseada em eventos do GitHub Webhook no branch `main`.

Fluxo:
`git push origin main` -> Dispara webhook (via porta webhook_receiver na VPS) -> `scripts/update.sh`

### Scripts Requeridos

1. `scripts/update.sh`:
   - Efetua `git pull`.
   - Roda script de backup (`scripts/backup.sh`).
   - Constrói as imagens: `docker compose build --pull api worker dashboard`.
   - Migrations do banco de dados: `npx prisma migrate deploy` via executor local/container.
   - Restart condicional: `docker compose up -d --no-deps`.
   - Chama script de validação de `health.sh`. Se falhar por mais de 60s, aciona `rollback.sh`.

2. `scripts/rollback.sh`:
   - Traz a stack down.
   - Aplica restore do banco (`pg_restore` do ultimo snapshot `backup.sql`).
   - Sobe a API com tag/sha anterior.

3. `scripts/health.sh`:
   - Loop em `/v1/health` esperando `status: "ONLINE"` do gateway e dos workers.

4. `scripts/doctor.sh`:
   - Checagem aprofundada: uso de `docker stats`, `free -m`, logs e contagem de retries.

## Interface do Deploy
O Dashboard devera ter uma tela (na section Settings ou em Overview) detalhando o ultimo deploy: Versao, Commit SHA, Timestamp, Status do BD e Rollback trigger (Botão "Voltar Versão").
