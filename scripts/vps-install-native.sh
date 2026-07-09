#!/usr/bin/env bash
# ====================================================
# AI Platform - Instalacao nativa de Ollama + ComfyUI na VPS
# ====================================================
# Roda direto na VPS (nao em container) porque:
#   - Ollama/ComfyUI dentro de Docker nao ganham nada (sem GPU aqui) e so
#     adicionam overhead de camada extra numa maquina ja limitada em RAM.
#   - Precisam ficar em 127.0.0.1 (loopback) para NAO expor porta publica -
#     so os containers api/worker acessam via host.docker.internal (o
#     docker-compose.yml ja mapeia host.docker.internal:host-gateway, que
#     funciona em Docker 20.10+/Linux igual funciona no Windows).
#
# IMPORTANTE - RAM: essa VPS tem ~5.78GB TOTAIS, compartilhados com o
# sistema ZAPAI que ja roda aqui. Ollama (qwen2.5:3b) + ComfyUI (SD1.5 +
# LCM-LoRA) juntos podem passar de 4GB em uso de pico. Por isso este script:
#   - cria swap se nao existir (rede de seguranca, evita OOM matando processo
#     do ZAPAI por engano)
#   - usa OLLAMA_MAX_LOADED_MODELS=1 e OLLAMA_KEEP_ALIVE curto (libera RAM
#     rapido entre usos, ao inves dos 30min usados na maquina local com GPU)
#   - so baixa 1 modelo de texto pequeno (qwen2.5:3b) - nao o gemma3:4b usado
#     localmente, que nao cabe com folga aqui
#   - ComfyUI roda com --cpu explicito e --disable-auto-launch
#
# NAO mexe em nada do ZAPAI: nao usa systemctl stop/restart em nenhum
# servico existente, nao reusa portas 4025/5432/6379/80/443/2090, nao
# altera nginx/openresty. So instala software novo e sobe servicos novos
# isolados em 127.0.0.1.
set -euo pipefail

log() { echo "[vps-install] $*"; }

# Detecta o gerenciador de pacotes (essa VPS e AlmaLinux/RHEL - dnf - mas o
# script fica portavel caso rode em Debian/Ubuntu tambem).
if command -v dnf >/dev/null 2>&1; then
  PKG_INSTALL="dnf install -y -q"
  ZSTD_PKG="zstd"
  GL_PKG="mesa-libGL"
  VENV_PKG=""
  # AlmaLinux/RHEL 9 vem com python3 = 3.9, mas o requirements.txt do ComfyUI
  # (pacote "av") exige Python >=3.10 - usa o python3.11 do proprio AppStream.
  PY_PKGS="python3.11 python3.11-pip"
  PYTHON_BIN="python3.11"
elif command -v apt-get >/dev/null 2>&1; then
  PKG_INSTALL="apt-get install -y -qq"
  apt-get update -qq
  ZSTD_PKG="zstd"
  GL_PKG="libgl1"
  VENV_PKG="python3-venv"
  PY_PKGS="python3 python3-pip"
  PYTHON_BIN="python3"
else
  log "ERRO: nenhum gerenciador de pacotes suportado (dnf/apt-get) encontrado"
  exit 1
fi

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

# ---------- Ollama ----------
if ! command -v zstd >/dev/null 2>&1; then
  log "instalando zstd (requerido pelo instalador do ollama)"
  $PKG_INSTALL "$ZSTD_PKG"
fi

if command -v ollama >/dev/null 2>&1; then
  log "ollama ja instalado ($(ollama --version 2>&1 | head -1))"
else
  log "instalando ollama"
  curl -fsSL https://ollama.com/install.sh | sh
fi

log "configurando systemd override do ollama (loopback + limites de RAM)"
mkdir -p /etc/systemd/system/ollama.service.d
cat > /etc/systemd/system/ollama.service.d/override.conf <<'EOF'
[Service]
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_MAX_LOADED_MODELS=1"
Environment="OLLAMA_KEEP_ALIVE=5m"
EOF
systemctl daemon-reload
systemctl enable ollama
systemctl restart ollama
sleep 3

log "baixando modelo qwen2.5:3b (unico modelo de texto - cabe na RAM disponivel)"
ollama pull qwen2.5:3b

# ---------- ComfyUI ----------
if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
  log "instalando $PYTHON_BIN + dependencias de sistema"
  $PKG_INSTALL $PY_PKGS git $VENV_PKG "$GL_PKG" >/dev/null
fi

COMFY_DIR="/opt/comfyui"
if [ -d "$COMFY_DIR" ]; then
  log "ComfyUI ja clonado em $COMFY_DIR"
else
  log "clonando ComfyUI em $COMFY_DIR"
  git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git "$COMFY_DIR"
fi

cd "$COMFY_DIR"
if [ ! -d venv ]; then
  log "criando venv python ($PYTHON_BIN)"
  "$PYTHON_BIN" -m venv venv
fi
log "instalando dependencias (torch CPU-only - sem CUDA, imagem menor e mais rapido de instalar)"
"$COMFY_DIR/venv/bin/pip" install --quiet --upgrade pip
# torchaudio tambem precisa vir do indice CPU explicitamente - o
# requirements.txt do ComfyUI lista "torchaudio" sem pin, e se ele nao
# estiver ja satisfeito nesse momento, o pip -r requirements.txt busca a
# build padrao (CUDA) do PyPI, que falha em runtime nesta VPS sem GPU
# (libcudart.so.13 nao existe) mesmo rodando com --cpu.
"$COMFY_DIR/venv/bin/pip" install --quiet torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu
"$COMFY_DIR/venv/bin/pip" install --quiet -r requirements.txt

mkdir -p "$COMFY_DIR/models/loras"

CKPT="$COMFY_DIR/models/checkpoints/DreamShaper_8_pruned.safetensors"
if [ ! -f "$CKPT" ]; then
  log "baixando checkpoint DreamShaper 8 (SD1.5, ~2GB)"
  curl -fL --retry 3 -o "$CKPT" \
    "https://huggingface.co/Lykon/DreamShaper/resolve/main/DreamShaper_8_pruned.safetensors"
fi

LORA="$COMFY_DIR/models/loras/lcm-lora-sdv1-5.safetensors"
if [ ! -f "$LORA" ]; then
  log "baixando LCM-LoRA sdv1-5 (~135MB) - reduz passos de ~20-25 para ~6"
  curl -fL --retry 3 -o "$LORA" \
    "https://huggingface.co/latent-consistency/lcm-lora-sdv1-5/resolve/main/pytorch_lora_weights.safetensors"
fi

log "configurando systemd service do ComfyUI (loopback, CPU-only)"
cat > /etc/systemd/system/comfyui.service <<EOF
[Unit]
Description=ComfyUI (AI Platform - image generation)
After=network.target

[Service]
Type=simple
WorkingDirectory=$COMFY_DIR
ExecStart=$COMFY_DIR/venv/bin/python main.py --listen 127.0.0.1 --port 8188 --cpu --disable-auto-launch
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable comfyui
systemctl restart comfyui

log "aguardando ComfyUI subir..."
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8188/system_stats >/dev/null 2>&1; then
    log "ComfyUI respondendo"
    break
  fi
  sleep 2
done

log "--- status final ---"
systemctl is-active ollama comfyui || true
curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && log "Ollama OK" || log "Ollama NAO respondeu"
curl -fsS http://127.0.0.1:8188/system_stats >/dev/null 2>&1 && log "ComfyUI OK" || log "ComfyUI NAO respondeu"
free -h
log "concluido"
