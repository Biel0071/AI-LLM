#!/usr/bin/env bash
# ====================================================
# AI Platform - Mescla o LCM-LoRA no checkpoint permanentemente
# ====================================================
# Reaplicar o LoRA via node LoraLoader a cada geracao custava ~30s fixos
# de overhead por chamada (patch dos pesos do UNet), mesmo com poucos
# passos de sampler - a maior parte do tempo de uma geracao de 512x512
# nao era o sampling em si, era isso. Mesclando o LoRA no checkpoint UMA
# VEZ (via node CheckpointSave do proprio ComfyUI) e usando o arquivo
# resultante direto, esse custo desaparece de todas as geracoes futuras.
#
# Precisa do container "comfyui" (perfil vps) ja rodando. Idempotente -
# se o arquivo mesclado ja existe, nao faz nada.
set -euo pipefail
cd "$(dirname "$0")/.."

MERGED_CKPT="DreamShaper_8_LCM_merged.safetensors"
MERGED_PATH="/opt/comfyui-models/checkpoints/${MERGED_CKPT}"

log() { echo "[merge-lcm] $*"; }

if [ -f "$MERGED_PATH" ]; then
  log "checkpoint mesclado ja existe em $MERGED_PATH, pulando"
else
  log "submetendo workflow de merge (checkpoint + LCM-LoRA -> CheckpointSave)"
  docker compose --profile vps exec -T comfyui python3 -c "
import urllib.request, json
graph = {
  '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': 'DreamShaper_8_pruned.safetensors'}},
  '2': {'class_type': 'LoraLoader', 'inputs': {'model': ['1',0], 'clip': ['1',1], 'lora_name': 'lcm-lora-sdv1-5.safetensors', 'strength_model': 1.0, 'strength_clip': 1.0}},
  '3': {'class_type': 'CheckpointSave', 'inputs': {'model': ['2',0], 'clip': ['2',1], 'vae': ['1',2], 'filename_prefix': 'DreamShaper_8_LCM_merged'}},
}
req = urllib.request.Request('http://127.0.0.1:8188/prompt', data=json.dumps({'prompt': graph}).encode(), headers={'Content-Type':'application/json'})
print(urllib.request.urlopen(req).read().decode())
"

  log "aguardando o merge terminar (fila do ComfyUI esvaziar)"
  for i in $(seq 1 60); do
    OUTFILE=$(docker compose --profile vps exec -T comfyui sh -c 'ls /app/output/DreamShaper_8_LCM_merged_*.safetensors 2>/dev/null | head -1' | tr -d '\r')
    if [ -n "$OUTFILE" ]; then break; fi
    sleep 2
  done

  if [ -z "${OUTFILE:-}" ]; then
    log "AVISO: nao apareceu o arquivo mesclado apos 2min - continuando sem merge (fica no modo LoRA separado, mais lento mas funcional)"
    exit 0
  fi

  log "copiando $OUTFILE do container pro host ($MERGED_PATH)"
  docker compose --profile vps cp "comfyui:${OUTFILE}" "$MERGED_PATH"
fi

if [ -f "$MERGED_PATH" ]; then
  log "apontando .env pro checkpoint mesclado (sem precisar mais do LoraLoader a cada geracao)"
  if grep -q '^COMFYUI_CHECKPOINT=' .env; then
    sed -i "s|^COMFYUI_CHECKPOINT=.*|COMFYUI_CHECKPOINT=${MERGED_CKPT}|" .env
  else
    echo "COMFYUI_CHECKPOINT=${MERGED_CKPT}" >> .env
  fi
  if grep -q '^COMFYUI_LCM_MODE=' .env; then
    sed -i "s|^COMFYUI_LCM_MODE=.*|COMFYUI_LCM_MODE=true|" .env
  else
    echo 'COMFYUI_LCM_MODE=true' >> .env
  fi
  # nao precisa mais - o LoRA ja esta mesclado no checkpoint acima
  sed -i '/^COMFYUI_LCM_LORA=/d' .env
  log "concluido - reinicie api/worker (docker compose --profile vps up -d api worker) pra aplicar"
fi
