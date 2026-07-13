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
# GPU_MAX_CONCURRENT=1 bloqueava TEXTO atras de QUALQUER imagem em andamento
# (semaforo global compartilhado entre as duas capacidades) - Ollama e
# ComfyUI sao containers SEPARADOS aqui (cada um com seu proprio limite de
# memoria via Docker), diferente da maquina local com 1 GPU fisica
# compartilhada (onde faz sentido serializar). IMAGE_WORKER_CONCURRENCY=1
# ja garante que so 1 imagem roda por vez na fila - nao precisa tambem
# travar texto atras dela.
set_env GPU_MAX_CONCURRENT 1
# WORKER_CONCURRENCY=4 (default) deixa ate 4 jobs de texto/seo rodando ao
# mesmo tempo. Testado em producao em 2 rodadas: mesmo com 2 (nao so 4),
# 2 textos + 1 imagem concorrentes ainda saturam a RAM dessa VPS (5.8GB
# total) o suficiente pra forcar swap em disco - passos de sampler que
# levam ~12s isolados passaram de 200-300s sob essa concorrencia. Nao e
# falta de nucleos de CPU, e falta de RAM pra manter Ollama + ComfyUI
# ambos com seus modelos carregados SEM swap enquanto ainda rodam mais
# de 1 geracao ao mesmo tempo. Ate um upgrade de RAM (32GB elimina isso
# de vez), 1 serializa TUDO (texto e imagem, um de cada vez) - mais lento
# por item mas garante que nenhum trava/aborta.
set_env WORKER_CONCURRENCY 1
# Limite compartilhado entre TODAS as filas. Sem ele, text/image/ocr/seo
# tinham concorrencia 1 cada, mas ainda podiam rodar simultaneamente.
set_env GLOBAL_WORKER_CONCURRENCY 1
set_env ADAPTIVE_CONCURRENCY true
set_env PROVIDER_REGISTRY_TTL_MS 15000
# Default de 90s foi calibrado pro tunel Cloudflare (que mata requests em
# ~100s) da maquina local - nao existe tunel na VPS (chamada direta
# container-a-container), entao pode ser bem mais generoso. Testado em
# producao: com 2 textos concorrentes (WORKER_CONCURRENCY=2), cada geracao
# de SEO completo (resposta longa) pode passar de 90s sob CPU dividida -
# 90s estava abortando textos legitimos, nao travados.
set_env OLLAMA_TIMEOUT_MS 180000
# JOB_WAIT_TIMEOUT_MS (endpoint sincrono /v1/jobs com wait:true) precisa
# ficar ACIMA do OLLAMA_TIMEOUT_MS acima, senao o cliente desiste antes do
# job ter chance de terminar dentro do proprio timeout do Ollama.
set_env JOB_WAIT_TIMEOUT_MS 240000
# Portas do host para postgres/redis - a 5432/6379 padrao ja esta em uso
# nativamente por outro sistema nesta VPS (ver cabecalho do script).
set_env POSTGRES_HOST_PORT 5433
set_env REDIS_HOST_PORT 6380
# Ollama/ComfyUI agora sao containers na mesma rede docker - alcancados
# pelo nome do servico, sem depender de host.docker.internal/firewall.
set_env OLLAMA_BASE_URL_DOCKER http://ollama:11434
set_env COMFYUI_BASE_URL_DOCKER http://comfyui:8188
# .env.example vem com o limite conservador (120/min) - Lovable subindo
# catalogo inteiro faz varias chamadas concorrentes por produto (texto +
# imagem), 600/min (10/s) da folga real pra lotes de 50-60 itens.
set_env RATE_LIMIT_MAX 600
# Fila "image" sempre roda 1 por vez (ComfyUI so processa 1 workflow por
# vez fisicamente) - explicito aqui pra nao depender do default do codigo.
set_env IMAGE_WORKER_CONCURRENCY 1
# .env.example vem com OLLAMA_DEFAULT_MODEL=llama3 (generico, exemplo) -
# essa VPS so tem qwen2.5:3b instalado. Sem isso, qualquer chamada de
# texto SEM task explicito (chat geral, "gerar descricao" etc) cai no
# roteamento "default" e falha com "model 'llama3' not found" upstream.
set_env OLLAMA_DEFAULT_MODEL qwen2.5:1.5b
set_env OLLAMA_FAST_MODEL qwen2.5:1.5b
set_env OLLAMA_QUALITY_MODEL qwen2.5:3b
set_env OLLAMA_NUM_PARALLEL 1
set_env OLLAMA_KEEP_ALIVE 30m
set_env OLLAMA_MAX_QUEUE 128
set_env COMFYUI_DEFAULT_WIDTH 256
set_env COMFYUI_DEFAULT_HEIGHT 256
set_env COMFYUI_DEFAULT_STEPS 3

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

# 4b. Watchdog do host: Docker nao reinicia um container apenas por estar
# unhealthy. O timer verifica a cada minuto e reinicia somente o componente
# afetado, sem derrubar o restante da plataforma.
install -m 0755 scripts/vps-watchdog.sh /usr/local/sbin/ai-platform-watchdog
cat >/etc/systemd/system/ai-platform-watchdog.service <<'EOF'
[Unit]
Description=AI Platform health recovery
After=docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/ai-platform-watchdog
EOF
cat >/etc/systemd/system/ai-platform-watchdog.timer <<'EOF'
[Unit]
Description=Run AI Platform health recovery every minute

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
AccuracySec=10s
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now ai-platform-watchdog.timer

# 5. Baixa os modelos dentro do container ollama (a primeira vez que sobe,
# o volume esta vazio). Os 3 juntos cabem em disco tranquilo (~4GB) - o
# OLLAMA_MAX_LOADED_MODELS=1 garante que so 1 fica carregado em RAM por
# vez, trocando conforme a capacidade chamada (texto/visao/embed).
echo '-- Baixando modelos dentro do container ollama (se ainda nao existirem) --'
docker compose --profile vps exec -T ollama ollama pull qwen2.5:3b
docker compose --profile vps exec -T ollama ollama pull qwen2.5:1.5b
docker compose --profile vps exec -T ollama ollama pull moondream
docker compose --profile vps exec -T ollama ollama pull nomic-embed-text

# 6. Mescla o LCM-LoRA no checkpoint (uma vez so) - reaplicar o LoRA via
# node a cada geracao custava ~30s fixos por chamada. Precisa do
# container comfyui ja rodando (passo 4 acima), por isso vem depois.
bash scripts/vps-merge-lcm-checkpoint.sh
docker compose --profile vps up -d api worker

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
