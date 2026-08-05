#!/bin/bash
# API Platform Enterprise v5.0 - Rollback Script
set -e

BACKUP_FILE=$1

echo "[API Platform] Iniciando Rollback de Emergência..."

if [ -z "$BACKUP_FILE" ]; then
    echo "[ERRO] Arquivo de backup não fornecido."
    exit 1
fi

echo "[API Platform] 1. Parando servicos..."
docker compose down

echo "[API Platform] 2. Retornando ao commit anterior (git reset)..."
git reset --hard HEAD~1

echo "[API Platform] 3. Subindo banco de dados puro para restore..."
docker compose up -d postgres
sleep 5

echo "[API Platform] 4. Restaurando backup SQL..."
cat "$BACKUP_FILE" | docker compose exec -T postgres psql -U apiplatform -d apiplatform

echo "[API Platform] 5. Subindo stack completa restaurada..."
docker compose up -d

echo "[API Platform] Rollback concluído. Ambiente na versao anterior."
