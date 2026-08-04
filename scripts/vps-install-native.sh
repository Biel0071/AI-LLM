#!/usr/bin/env bash
# ====================================================
# API Platform - Preparacao nativa da VPS (swap + modelos ComfyUI)
# ====================================================
# Ollama e ComfyUI agora rodam DENTRO de containers Docker (perfil "vps"
# do docker-compose.yml), nao mais nativos no host - isso evita de vez os
# problemas de firewall/roteamento entre container e servico do host
# (host.docker.internal, iptables, zonas do firewalld). Este script so
# cuida do que ainda precisa ser feito FORA do Docker:
#   - swap (rede de seguranca de memoria - RAM curta nesta VPS)
#   - baixar o checkpoint SD1.5 + LCM-LoRA para /opt/comfyui-models, que
#     o docker-compose.yml monta como bind mount no container comfyui
#     (evita rebaixar ~2GB toda vez que o container e recriado)
#
# NAO mexe em nada do ZAPAI: nao usa systemctl stop/restart em nenhum
# servico existente, nao reusa portas 4025/5432/6379/80/443/2090.
set -euo pipefail

log() { echo "[vps-install] $*"; }

# ---------- Swap (rede de seguranca de memoria) ----------
# Tamanho por tier: o deploy passa SWAP_SIZE_GB (lite=4, power=8). Default 4
# se chamado diretamente sem o env.
SWAP_SIZE_GB="${SWAP_SIZE_GB:-4}"
if [ -f /swapfile ] || swapon --show | grep -q .; then
  log "swap ja existe, pulando"
else
  log "criando swap de ${SWAP_SIZE_GB}G em /swapfile"
  fallocate -l "${SWAP_SIZE_GB}G" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  if ! grep -q '^/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  sysctl -w vm.swappiness=10
  if ! grep -q '^vm.swappiness' /etc/sysctl.conf 2>/dev/null; then
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
  fi
fi

# ---------- Modelos do ComfyUI (bind mount no container) ----------
mkdir -p /opt/comfyui-models/checkpoints /opt/comfyui-models/loras

# Download robusto: o CDN do HuggingFace (us.aws.cdn.hf.co / xet-bridge) as
# vezes corta a conexao no meio de arquivos grandes. Um curl unico com --retry
# nao resolve isso porque a falha e no meio do stream, nao no inicio. Aqui
# fazemos um loop com resume real (-C -, que pede Range a partir do que ja
# existe) e so aceitamos o arquivo quando ele atinge o tamanho esperado
# (descoberto via header content-length, seguindo o redirect). Sem isso, o
# set -e do deploy abortava tudo quando o LoRA baixava parcial.
download_verified() {
  local url="$1" dest="$2" label="$3"
  local target
  target=$(curl -fsSLI "$url" 2>/dev/null | awk 'tolower($1)=="content-length:"{v=$2} END{gsub(/\r/,"",v); print v}')
  if [ -f "$dest" ] && [ -n "$target" ] && [ "$(stat -c%s "$dest" 2>/dev/null || echo 0)" -ge "$target" ]; then
    log "$label ja completo, pulando"; return 0
  fi
  log "baixando $label"
  local i sz
  for i in 1 2 3 4 5 6 7 8; do
    curl -fsSL --retry 3 --retry-delay 2 -C - -o "$dest" "$url" >/dev/null 2>&1 || true
    sz=$(stat -c%s "$dest" 2>/dev/null || echo 0)
    if [ -z "$target" ]; then
      # Sem content-length conhecido: aceita o que baixou sem cortar no loop.
      [ "$sz" -gt 0 ] && { log "$label baixado (${sz} bytes)"; return 0; }
    elif [ "$sz" -ge "$target" ]; then
      log "$label completo (${sz}/${target} bytes)"; return 0
    fi
    log "$label parcial (${sz}/${target:-?} bytes) - retomando (tentativa $i)"
    sleep 2
  done
  log "ERRO: falha ao baixar $label completo apos varias tentativas"; return 1
}

download_verified \
  "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors" \
  "/opt/comfyui-models/checkpoints/DreamShaper_8_pruned.safetensors" \
  "checkpoint DreamShaper 8 (SD1.5, ~2GB)"

download_verified \
  "https://huggingface.co/latent-consistency/lcm-lora-sdv1-5/resolve/main/pytorch_lora_weights.safetensors" \
  "/opt/comfyui-models/loras/lcm-lora-sdv1-5.safetensors" \
  "LCM-LoRA sdv1-5 (~135MB, reduz passos de ~20-25 para ~6)"

log "concluido"
