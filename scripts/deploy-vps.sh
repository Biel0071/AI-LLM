#!/usr/bin/env bash
# ====================================================
# AI Platform - Deploy em VPS COMPARTILHADA (Ubuntu/Debian)
# Instala Docker se necessario, configura .env, instala Ollama+ComfyUI
# nativos e sobe a stack - tudo em portas que NAO conflitam com sistemas
# ja rodando na mesma VPS (ex: ZAPAI usando 4025/5432/6379/80/443/2090).
#
# Portas usadas por este deploy: 3000 (api), 8080 (dashboard), 5433
# (postgres, host->5432 interno), 6380 (redis, host->6379 interno),
# 11434 (ollama, loopback), 8188 (comfyui, loopback).
#
# Este script NAO para, reinicia ou reconfigura nenhum servico existente
# na VPS - so instala software novo e sobe containers/servicos isolados.
# ====================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo '== AI Platform - deploy VPS (multi-tenant, nao mexe em outros sistemas) =='

# 0. Aviso de portas em uso (nao falha o script, so avisa)
echo '-- Verificando portas ja em uso na VPS --'
for p in 3000 8080 5433 6380 11434 8188; do
  if ss -ltn "( sport = :$p )" 2>/dev/null | grep -q ":$p"; then
    echo "  AVISO: porta $p ja esta em uso - pode ser este proprio deploy rodando de novo, ou conflito real. Confira antes de continuar."
  fi
done

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

# 2b. Ajustes idempotentes no .env (rodam sempre, mesmo em .env ja existente
# de uma execucao anterior) - usa append-se-ausente em vez de sed, porque
# .env.example pode nao ter a chave ainda.
set_env() {
  # $1=chave $2=valor
  if grep -q "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    echo "$1=$2" >> .env
  fi
}
# LCM-LoRA ligado por padrao na VPS (CPU-only, precisa dos passos reduzidos)
set_env COMFYUI_LCM_LORA lcm-lora-sdv1-5.safetensors
# So 1 geracao de imagem por vez em CPU - RAM/CPU limitados nao aguentam paralelo
set_env GPU_MAX_CONCURRENT 1
# Portas do host para postgres/redis - a 5432/6379 padrao ja esta em uso
# nativamente por outro sistema nesta VPS (ver cabecalho do script).
set_env POSTGRES_HOST_PORT 5433
set_env REDIS_HOST_PORT 6380

# 3. Ollama + ComfyUI nativos (sem GPU nesta VPS - rodar em container so
#    adicionaria overhead sem ganho nenhum)
echo '-- Instalando Ollama + ComfyUI nativos --'
bash scripts/vps-install-native.sh

# 4. Stack Docker - POSTGRES_HOST_PORT/REDIS_HOST_PORT no .env evitam
# conflito com as portas 5432/6379 nativas de outros sistemas na VPS.
docker compose up -d --build

echo
echo '== Deploy concluido =='
echo '  API:       http://SEU_IP:3000  (Swagger em /docs)'
echo '  Dashboard: http://SEU_IP:8080'
echo '  Postgres:  host 5433 -> container 5432 (nao usa a 5432 nativa da VPS)'
echo '  Redis:     host 6380 -> container 6379 (nao usa a 6379 nativa da VPS)'
echo '  Ollama:    127.0.0.1:11434 (nativo, so acessivel pelos containers)'
echo '  ComfyUI:   127.0.0.1:8188 (nativo, so acessivel pelos containers)'
echo
echo 'Recomendado: coloque um proxy TLS na frente (Traefik/Caddy/nginx + certbot).'
echo 'Exemplo Traefik: docs/DEPLOY.md'
