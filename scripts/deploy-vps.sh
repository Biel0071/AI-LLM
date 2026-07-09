#!/usr/bin/env bash
# ====================================================
# AI Platform - Deploy em VPS (Ubuntu/Debian)
# Instala Docker se necessario, configura .env e sobe a stack.
# Nao muda nenhuma linha de codigo: apenas variaveis de ambiente.
# ====================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo '== AI Platform - deploy VPS =='

# 1. Docker
if ! command -v docker >/dev/null 2>&1; then
  echo 'Instalando Docker...'
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

# 2. .env de producao
if [ ! -f .env ]; then
  cp .env.example .env
  # Gera segredos fortes automaticamente
  JWT=$(openssl rand -hex 32)
  APIKEY="ap_$(openssl rand -hex 24)"
  PASS=$(openssl rand -hex 12)
  sed -i "s|^NODE_ENV=.*|NODE_ENV=production|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT}|" .env
  sed -i "s|^DEFAULT_API_KEY=.*|DEFAULT_API_KEY=${APIKEY}|" .env
  sed -i "s|^ADMIN_PASSWORD=.*|ADMIN_PASSWORD=${PASS}|" .env
  echo '--------------------------------------------------'
  echo "  ADMIN_PASSWORD:  ${PASS}"
  echo "  DEFAULT_API_KEY: ${APIKEY}"
  echo '  (guarde estes valores; tambem estao no .env)'
  echo '--------------------------------------------------'
fi

# 3. Stack
docker compose up -d --build

echo
echo '== Deploy concluido =='
echo '  API:       http://SEU_IP:3000  (Swagger em /docs)'
echo '  Dashboard: http://SEU_IP:8080'
echo
echo 'Recomendado: coloque um proxy TLS na frente (Traefik/Caddy/nginx + certbot).'
echo 'Exemplo Traefik: docs/DEPLOY.md'
