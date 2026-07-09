#!/usr/bin/env bash
# ====================================================
# AI Platform - Deploy em VPS COMPARTILHADA (Ubuntu/Debian/RHEL)
# Instala Docker se necessario, configura .env e sobe a stack - tudo em
# portas que NAO conflitam com sistemas ja rodando na mesma VPS (ex:
# ZAPAI usando 4025/5432/6379/80/443/2090).
#
# Ollama e ComfyUI rodam em CONTAINERS (perfil "vps"), nao nativos no
# host - evita de vez os problemas de firewall/roteamento entre container
# e servico do host (host.docker.internal, iptables, zonas do firewalld).
#
# Portas expostas no HOST por este deploy: 3000 (api), 8080 (dashboard),
# 5433 (postgres, container 5432), 6380 (redis, container 6379). Ollama
# (11434) e ComfyUI (8188) ficam SO na rede interna do Docker - nenhuma
# porta nova exposta no host pra eles.
#
# Este script NAO para, reinicia ou reconfigura nenhum servico existente
# na VPS - so instala software novo e sobe containers isolados.
# ====================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo '== AI Platform - deploy VPS (multi-tenant, nao mexe em outros sistemas) =='

# 0. Aviso de portas em uso (nao falha o script, so avisa)
echo '-- Verificando portas ja em uso na VPS --'
for p in 3000 8080 5433 6380; do
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
# Checkpoint que realmente baixamos pra VPS (vps-install-native.sh) - o
# .env.example por padrao aponta pro SDXL base, que nao existe aqui.
set_env COMFYUI_CHECKPOINT DreamShaper_8_pruned.safetensors
# LCM-LoRA ligado por padrao na VPS (CPU-only, precisa dos passos reduzidos)
set_env COMFYUI_LCM_LORA lcm-lora-sdv1-5.safetensors
# So 1 geracao de imagem por vez em CPU - RAM/CPU limitados nao aguentam paralelo
set_env GPU_MAX_CONCURRENT 1
# Portas do host para postgres/redis - a 5432/6379 padrao ja esta em uso
# nativamente por outro sistema nesta VPS (ver cabecalho do script).
set_env POSTGRES_HOST_PORT 5433
set_env REDIS_HOST_PORT 6380
# Ollama/ComfyUI agora sao containers na mesma rede docker - alcancados
# pelo nome do servico, sem depender de host.docker.internal/firewall.
set_env OLLAMA_BASE_URL_DOCKER http://ollama:11434
set_env COMFYUI_BASE_URL_DOCKER http://comfyui:8188

# 3. Modelos do ComfyUI + swap (unica coisa que ainda roda fora do Docker)
echo '-- Preparando swap e baixando modelos do ComfyUI --'
bash scripts/vps-install-native.sh

# 3b. Se um Ollama/ComfyUI nativo de uma execucao anterior deste mesmo
# script ainda estiver rodando (versao antiga, pre-containerizacao), para
# e desabilita - eles foram substituidos pelos containers abaixo. So mexe
# nos servicos "ollama"/"comfyui" criados por ESTE projeto, nada do ZAPAI.
for svc in ollama comfyui; do
  if systemctl list-unit-files "${svc}.service" >/dev/null 2>&1 && systemctl is-enabled "${svc}.service" >/dev/null 2>&1; then
    echo "-- Desativando servico nativo antigo: ${svc} (substituido por container) --"
    systemctl disable --now "${svc}.service" || true
  fi
done

# 4. Stack Docker - perfil "vps" inclui os containers ollama/comfyui.
# POSTGRES_HOST_PORT/REDIS_HOST_PORT no .env evitam conflito com as
# portas 5432/6379 nativas de outros sistemas na VPS.
docker compose --profile vps up -d --build

# 5. Baixa o modelo de texto dentro do container ollama (a primeira vez
# que sobe, o volume esta vazio).
echo '-- Baixando modelo qwen2.5:3b dentro do container ollama (se ainda nao existir) --'
docker compose --profile vps exec -T ollama ollama pull qwen2.5:3b

echo
echo '== Deploy concluido =='
echo '  API:       http://SEU_IP:3000  (Swagger em /docs)'
echo '  Dashboard: http://SEU_IP:8080'
echo '  Postgres:  host 5433 -> container 5432 (nao usa a 5432 nativa da VPS)'
echo '  Redis:     host 6380 -> container 6379 (nao usa a 6379 nativa da VPS)'
echo '  Ollama:    container "ollama", so na rede interna do Docker'
echo '  ComfyUI:   container "comfyui", so na rede interna do Docker'
echo
echo 'Recomendado: coloque um proxy TLS na frente (Traefik/Caddy/nginx + certbot).'
echo 'Exemplo Traefik: docs/DEPLOY.md'
