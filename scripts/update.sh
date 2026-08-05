#!/bin/bash
# API Platform Enterprise v5.0 - Continuous Deployment Script
set -e

echo "[API Platform] Inciando Update Automatico (VPS First)..."

# 1. Atualiza repositório
echo "[API Platform] Git Pull..."
git checkout main
git pull origin main

# 2. Backup do Banco (segurança antes de build/migrations)
echo "[API Platform] Efetuando backup do Postgres..."
BACKUP_FILE="backup-$(date +%s).sql"
docker compose exec -T postgres pg_dump -U apiplatform apiplatform > "/tmp/${BACKUP_FILE}"
echo "[API Platform] Backup salvo em /tmp/${BACKUP_FILE}"

# 3. Build das imagens
echo "[API Platform] Executando docker compose build..."
docker compose build --pull api worker dashboard

# 4. Sobe API e Dashboard para aplicar migrations
echo "[API Platform] Restartando Servicos..."
docker compose up -d

# 5. Aplica migrations via container da API
echo "[API Platform] Rodando migrations via Prisma..."
docker compose exec -T api npx prisma migrate deploy

# 6. Verifica a saude
echo "[API Platform] Efetuando Smoke Tests e Health Check..."
bash scripts/health.sh

if [ $? -ne 0 ]; then
    echo "[API Platform] Health check FALHOU! Iniciando rollback automático..."
    bash scripts/rollback.sh "/tmp/${BACKUP_FILE}"
    exit 1
fi

echo "[API Platform] Update concluído com sucesso. ONLINE."
