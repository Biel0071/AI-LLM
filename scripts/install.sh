#!/usr/bin/env bash
# ====================================================
# AI Platform - Instalacao Linux / macOS
# Requisitos: Docker + Docker Compose plugin
# ====================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo '== AI Platform - instalacao (Linux/macOS) =='

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker nao encontrado. Instale: https://docs.docker.com/engine/install/' >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo 'Arquivo .env criado a partir de .env.example - revise as chaves dos providers.'
fi

echo 'Construindo e subindo containers...'
docker compose up -d --build

echo
echo '== Pronto! =='
echo '  API:        http://localhost:3000  (Swagger em /docs)'
echo '  Dashboard:  http://localhost:8080'
echo '  Login:      ADMIN_EMAIL / ADMIN_PASSWORD do .env'
echo '  API key:    DEFAULT_API_KEY do .env (header x-api-key)'
