#!/usr/bin/env bash
# ====================================================
# AI Platform - Preparacao nativa da VPS (swap + modelos ComfyUI)
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
if [ -f /swapfile ] || swapon --show | grep -q .; then
  log "swap ja existe, pulando"
else
  log "criando swap de 4G em /swapfile"
  fallocate -l 4G /swapfile
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

CKPT="/opt/comfyui-models/checkpoints/DreamShaper_8_pruned.safetensors"
if [ ! -f "$CKPT" ]; then
  log "baixando checkpoint DreamShaper 8 (SD1.5, ~2GB)"
  curl -fL --retry 3 -o "$CKPT" \
    "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors"
fi

LORA="/opt/comfyui-models/loras/lcm-lora-sdv1-5.safetensors"
if [ ! -f "$LORA" ]; then
  log "baixando LCM-LoRA sdv1-5 (~135MB) - reduz passos de ~20-25 para ~6"
  curl -fL --retry 3 -o "$LORA" \
    "https://huggingface.co/latent-consistency/lcm-lora-sdv1-5/resolve/main/pytorch_lora_weights.safetensors"
fi

log "concluido"
