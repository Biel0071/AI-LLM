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
#
# AUTO-ESCALA POR HARDWARE: detecta RAM/CPU da VPS e escolhe um "tier" de
# tunagem (lite p/ VPS fraca ~6GB, power p/ VPS forte >=14GB). O tier define
# apenas os TETOS (concorrencia, resolucao de imagem, limites de RAM dos
# containers, swap); o worker continua ajustando a concorrencia real em
# runtime pra baixo sob pressao (apps/worker tuneConcurrency le /proc/meminfo).
# Assim o MESMO script roda na VPS atual e na nova sem manter duas versoes.
# ====================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo '== AI Platform - deploy VPS (multi-tenant, nao mexe em outros sistemas) =='

# -- Deteccao de hardware e escolha de tier --------------------------------
# RAM total em MB e nucleos de CPU. Override manual: AI_PLATFORM_TIER=lite|power
detect_ram_mb() { awk '/^MemTotal:/ {print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0; }
detect_cpus() { nproc 2>/dev/null || echo 1; }
RAM_MB=$(detect_ram_mb)
CPUS=$(detect_cpus)
TIER="${AI_PLATFORM_TIER:-}"
if [ -z "$TIER" ]; then
  # >=14GB de RAM E >=5 vCPU => power. Abaixo disso, lite (seguro na VPS fraca).
  if [ "$RAM_MB" -ge 14000 ] && [ "$CPUS" -ge 5 ]; then TIER=power; else TIER=lite; fi
fi
echo "-- Hardware detectado: ${RAM_MB}MB RAM, ${CPUS} vCPU -> tier=${TIER} --"

# Perfis de tunagem por tier. Cada variavel abaixo e consumida pelos set_env
# e pelos mem_limits do docker-compose (exportadas no ambiente do compose).
if [ "$TIER" = power ]; then
  # VPS forte (ex: 6 vCPU / 16GB): Ollama + ComfyUI cabem residentes sem swap,
  # entao subimos concorrencia, resolucao e limites de RAM dos containers.
  TIER_WORKER_CONCURRENCY=4
  TIER_GLOBAL_CONCURRENCY=4
  TIER_SYNC_TEXT_CONCURRENCY=3
  TIER_IMG_W=512
  TIER_IMG_H=512
  TIER_IMG_STEPS=4
  TIER_GALLERY_MAX=3
  TIER_OLLAMA_MAX_LOADED=2        # texto + visao residentes juntos
  TIER_DEFAULT_MODEL=qwen2.5:3b
  TIER_QUALITY_MODEL=qwen2.5:3b
  TIER_SWAP_GB=8
  # Tetos de RAM (mem_limit e teto, nao reserva). Soma ~16.5g de teto numa
  # maquina de 16g de proposito: os picos de Ollama e ComfyUI nao coincidem
  # (o AdaptiveJobScheduler serializa imagem), e o swap de 8g cobre o pico
  # raro. Ollama e ComfyUI ficam em 6g cada - folga real sem estourar.
  TIER_MEM_POSTGRES=1g
  TIER_MEM_REDIS=768m
  TIER_MEM_API=1536m
  TIER_MEM_WORKER=1536m
  TIER_MEM_OLLAMA=6g
  TIER_MEM_COMFYUI=6g
else
  # VPS fraca (~6GB): serializa tudo (1 de cada vez) - valores identicos aos
  # que ja estavam fixos aqui, calibrados em producao. Nada muda pra essa VPS.
  TIER_WORKER_CONCURRENCY=1
  TIER_GLOBAL_CONCURRENCY=1
  TIER_SYNC_TEXT_CONCURRENCY=1
  TIER_IMG_W=256
  TIER_IMG_H=256
  TIER_IMG_STEPS=3
  TIER_GALLERY_MAX=1
  TIER_OLLAMA_MAX_LOADED=1
  TIER_DEFAULT_MODEL=qwen2.5:1.5b
  TIER_QUALITY_MODEL=qwen2.5:3b
  TIER_SWAP_GB=4
  TIER_MEM_POSTGRES=512m
  TIER_MEM_REDIS=640m
  TIER_MEM_API=768m
  TIER_MEM_WORKER=768m
  TIER_MEM_OLLAMA=3g
  TIER_MEM_COMFYUI=4g
fi

# 0. Portas do host - auto-deteccao. O plano ICP inclui painel, que pode ou
# nao ocupar 5432/6379. Escolhe automaticamente uma porta livre pra
# postgres/redis (offset padrao 5433/6380 como na VPS atual); se ate essas
# estiverem ocupadas, sobe procurando a proxima livre. api(3000)/dashboard
# (8080) ficam fixos - se um deles conflitar, e avisado pra decisao manual.
port_in_use() { ss -ltn "( sport = :$1 )" 2>/dev/null | grep -q ":$1"; }
first_free_port() { local p="$1"; while port_in_use "$p"; do p=$((p+1)); done; echo "$p"; }
echo '-- Verificando portas ja em uso na VPS --'
for p in 3000 8080; do
  if port_in_use "$p"; then
    echo "  AVISO: porta $p (fixa) ja em uso - pode ser este deploy rodando de novo, ou conflito real. Confira antes de continuar."
  fi
done
PG_PORT=$(first_free_port 5433)
RD_PORT=$(first_free_port 6380)
echo "  Postgres host -> ${PG_PORT} | Redis host -> ${RD_PORT}"

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
# WORKER_CONCURRENCY e o TETO de jobs leves (texto/seo) simultaneos; o worker
# ajusta pra baixo em runtime sob pressao de RAM/CPU (tuneConcurrency le
# /proc/meminfo). No tier lite (~6GB) fica 1: 2 textos + 1 imagem ja saturavam
# a RAM e forcavam swap (passos de sampler de ~12s viravam 200-300s). No tier
# power (>=14GB) sobe pra 4: Ollama + ComfyUI cabem residentes sem swap, entao
# jobs leves rodam de verdade em paralelo. Definido por hardware acima.
set_env WORKER_CONCURRENCY "$TIER_WORKER_CONCURRENCY"
# Limite compartilhado entre TODAS as filas (semaforo global do scheduler).
set_env GLOBAL_WORKER_CONCURRENCY "$TIER_GLOBAL_CONCURRENCY"
set_env SYNC_TEXT_CONCURRENCY "$TIER_SYNC_TEXT_CONCURRENCY"
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
# Portas do host para postgres/redis - auto-detectadas no passo 0 (evitam
# conflito com o painel/outro sistema da VPS).
set_env POSTGRES_HOST_PORT "$PG_PORT"
set_env REDIS_HOST_PORT "$RD_PORT"
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
# Imagens de vitrine por job de galeria - lite=1 (CPU escassa), power=3.
set_env GALLERY_MAX_IMAGES_PER_JOB "$TIER_GALLERY_MAX"
# .env.example vem com OLLAMA_DEFAULT_MODEL=llama3 (generico, exemplo) -
# essa VPS so tem qwen2.5:3b instalado. Sem isso, qualquer chamada de
# texto SEM task explicito (chat geral, "gerar descricao" etc) cai no
# roteamento "default" e falha com "model 'llama3' not found" upstream.
# Modelo default de texto por tier: lite usa o 1.5b (mais leve/rapido na CPU
# escassa); power usa o 3b (mais qualidade, cabe na RAM). FAST segue o default.
set_env OLLAMA_DEFAULT_MODEL "$TIER_DEFAULT_MODEL"
set_env OLLAMA_FAST_MODEL "$TIER_DEFAULT_MODEL"
set_env OLLAMA_QUALITY_MODEL "$TIER_QUALITY_MODEL"
set_env OLLAMA_NUM_PARALLEL 1
set_env OLLAMA_KEEP_ALIVE 30m
set_env OLLAMA_MAX_QUEUE 128
# Quantos modelos o Ollama mantem residentes: lite=1 (troca sob demanda),
# power=2 (texto + visao juntos, sem recarregar). Consumido pelo compose.
export OLLAMA_MAX_LOADED_MODELS="$TIER_OLLAMA_MAX_LOADED"
# Resolucao/passos de imagem por tier - lite 256x256/3, power 512x512/4.
set_env COMFYUI_DEFAULT_WIDTH "$TIER_IMG_W"
set_env COMFYUI_DEFAULT_HEIGHT "$TIER_IMG_H"
set_env COMFYUI_DEFAULT_STEPS "$TIER_IMG_STEPS"
# Checkpoint LCM mesclado instalado pelo provisionamento: 3 passos reais,
# sem custo do node LoraLoader a cada requisicao.
set_env COMFYUI_CHECKPOINT DreamShaper_8_LCM_merged.safetensors
set_env COMFYUI_LCM_MODE true

# 3. Modelos do ComfyUI + swap (unica coisa que ainda roda fora do Docker).
# SWAP_SIZE_GB por tier: lite=4G, power=8G. O script nativo respeita esse env.
echo '-- Preparando swap e baixando modelos do ComfyUI --'
SWAP_SIZE_GB="$TIER_SWAP_GB" bash scripts/vps-install-native.sh

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
# portas nativas de outros sistemas na VPS. Os limites de RAM dos containers
# vem do tier detectado (exportados aqui pro docker-compose interpolar).
export MEM_POSTGRES="$TIER_MEM_POSTGRES" MEM_REDIS="$TIER_MEM_REDIS"
export MEM_API="$TIER_MEM_API" MEM_WORKER="$TIER_MEM_WORKER"
export MEM_OLLAMA="$TIER_MEM_OLLAMA" MEM_COMFYUI="$TIER_MEM_COMFYUI"
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
# o volume esta vazio). Os 4 juntos cabem em disco tranquilo (~4GB) - o
# OLLAMA_MAX_LOADED_MODELS (1 no tier lite, 2 no power) controla quantos
# ficam carregados em RAM ao mesmo tempo, trocando conforme a capacidade.
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

# IP publico da VPS pra montar a URL de apontamento dos outros projetos
# (Lovable etc). Best-effort: tenta servico externo, cai pro IP local.
PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo 'SEU_IP')
API_KEY_VALUE=$(grep -E '^DEFAULT_API_KEY=' .env | cut -d= -f2-)

echo
echo '== Deploy concluido =='
echo "  Tier aplicado: ${TIER}  (${RAM_MB}MB RAM, ${CPUS} vCPU)"
echo "  API:       http://${PUBLIC_IP}:3000  (Swagger em /docs)"
echo "  Dashboard: http://${PUBLIC_IP}:8080"
echo "  Postgres:  host ${PG_PORT} -> container 5432 (nao usa a nativa da VPS)"
echo "  Redis:     host ${RD_PORT} -> container 6379 (nao usa a nativa da VPS)"
echo '  Ollama:    container "ollama", so na rede interna do Docker'
echo '  ComfyUI:   container "comfyui", so na rede interna do Docker'
echo
echo '== Apontamento dos outros projetos (Lovable / SaaS) =='
echo '  Cadastre estes secrets server-side (NUNCA no frontend/VITE_):'
echo "    AI_PLATFORM_BASE_URL=http://${PUBLIC_IP}:3000"
echo "    AI_PLATFORM_API_KEY=${API_KEY_VALUE}"
echo '  Guia completo: docs/LOVABLE-PRODUCTION-INTEGRATION.md'
echo
echo 'Recomendado: coloque um proxy TLS na frente (Traefik/Caddy/nginx + certbot)'
echo 'e use https://SEU_DOMINIO como AI_PLATFORM_BASE_URL. Exemplo: docs/DEPLOY.md'
