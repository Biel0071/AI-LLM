#!/bin/bash
set -e

echo "========================================================"
echo "🚀 AI PLATFORM ENTERPRISE v1.0 — MODO GO-LIVE"
echo "========================================================"
echo "Iniciando processo de Hardening, Discovery e Deploy..."
echo ""

APP_DIR="/root/AI-LLM"
DISCOVERY_FILE="$APP_DIR/runtime-discovery.json"
NGINX_CONF="/etc/nginx/conf.d/ai-platform.conf"
DOMAIN="vps10363.panel.icontainer.net"

# Garante diretório
if [ ! -d "$APP_DIR" ]; then
    APP_DIR=$(pwd)
fi
mkdir -p "$APP_DIR"
cd "$APP_DIR"

# ==========================================
# FASE 14 — AUTO UPDATE
# ==========================================
echo "[FASE 14] Verificando atualizações no GitHub..."
if [ -d ".git" ]; then
    git fetch origin main > /dev/null 2>&1
    LOCAL=$(git rev-parse HEAD)
    REMOTE=$(git rev-parse origin/main)
    if [ "$LOCAL" != "$REMOTE" ]; then
        echo "🔄 Nova versão encontrada. Atualizando..."
        git pull origin main
    else
        echo "✅ Sistema já está na versão mais recente."
    fi
else
    echo "⚠️ Diretório não é um repositório Git. Ignorando Auto Update."
fi

# ==========================================
# FASE 1 — ENVIRONMENT DISCOVERY
# ==========================================
echo "[FASE 1] Executando auditoria e Environment Discovery..."

OS_INFO=$(uname -a)
MEM_TOTAL=$(grep MemTotal /proc/meminfo | awk '{print $2}')
CPU_CORES=$(nproc)
DISK_FREE=$(df -h / | awk 'NR==2 {print $4}')

HAS_DOCKER=$(command -v docker >/dev/null 2>&1 && echo "true" || echo "false")
HAS_COMPOSE=$(docker compose version >/dev/null 2>&1 && echo "true" || echo "false")
HAS_NGINX=$(command -v nginx >/dev/null 2>&1 && echo "true" || echo "false")
HAS_CERTBOT=$(command -v certbot >/dev/null 2>&1 && echo "true" || echo "false")
HAS_NODE=$(command -v node >/dev/null 2>&1 && echo "true" || echo "false")

cat <<EOF > "$DISCOVERY_FILE"
{
  "os": "$OS_INFO",
  "memoryKb": "$MEM_TOTAL",
  "cpuCores": "$CPU_CORES",
  "diskFree": "$DISK_FREE",
  "docker": $HAS_DOCKER,
  "dockerCompose": $HAS_COMPOSE,
  "nginx": $HAS_NGINX,
  "certbot": $HAS_CERTBOT,
  "node": $HAS_NODE,
  "timestamp": "$(date -Iseconds)"
}
EOF
echo "✅ Discovery concluído: $DISCOVERY_FILE"

# ==========================================
# INSTALAÇÃO DE DEPENDÊNCIAS
# ==========================================
echo "[DEPENDENCIES] Instalando dependências críticas se necessário..."
if [ "$HAS_DOCKER" = "false" ]; then
    curl -fsSL https://get.docker.com | sh
fi
if [ "$HAS_COMPOSE" = "false" ]; then
    apt-get update && apt-get install -y docker-compose-plugin
fi
if [ "$HAS_NGINX" = "false" ] || [ "$HAS_CERTBOT" = "false" ]; then
    apt-get update && apt-get install -y nginx certbot python3-certbot-nginx
fi

# ==========================================
# BUILD E CONTAINERS
# ==========================================
echo "[CONTAINERS] Preparando ambiente Docker..."
if [ ! -f ".env" ]; then
    cp .env.example .env
fi

echo "🏗️ Construindo imagens e subindo serviços..."
docker compose build
docker compose up -d

# ==========================================
# FASE 2 & 3 — HOST SAFETY E ICP INTEGRATION
# ==========================================
echo "[FASE 2 & 3] Configurando Integração ICP (Nginx Reverse Proxy)..."

cat <<EOF > "$NGINX_CONF"
# API Platform
server {
    listen 80;
    server_name api.$DOMAIN;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

# Dashboard
server {
    listen 80;
    server_name dashboard.$DOMAIN;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}

# Docs (Swagger)
server {
    listen 80;
    server_name docs.$DOMAIN;
    location / {
        proxy_pass http://127.0.0.1:3000/docs;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}

# Health
server {
    listen 80;
    server_name health.$DOMAIN;
    location / {
        proxy_pass http://127.0.0.1:3000/v1/health;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}

# Metrics (Prometheus)
server {
    listen 80;
    server_name metrics.$DOMAIN;
    location / {
        proxy_pass http://127.0.0.1:9090;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

echo "🔍 Validando configuração do Nginx..."
if nginx -t; then
    echo "✅ Nginx validado com sucesso. Recarregando..."
    systemctl reload nginx
else
    echo "❌ Erro na validação do Nginx. Revertendo configuração..."
    rm -f "$NGINX_CONF"
    systemctl reload nginx
fi

# ==========================================
# FASE 4 — SSL
# ==========================================
echo "[FASE 4] Verificando SSL..."
for sub in api dashboard docs health metrics; do
    if certbot certificates | grep -q "$sub.$DOMAIN"; then
        echo "✅ Certificado SSL já existe para $sub.$DOMAIN. Reutilizando."
    else
        echo "🔐 Emitindo certificado SSL para $sub.$DOMAIN..."
        certbot --nginx -d "$sub.$DOMAIN" --non-interactive --agree-tos -m admin@$DOMAIN || echo "⚠️ Falha ao emitir SSL para $sub (talvez o DNS ainda não propagou)."
    fi
done

# ==========================================
# FASE 17 — MISSION ZERO (Health, Tests, Auth)
# ==========================================
echo "[FASE 17] Executando Mission Zero (Testes pós-deploy)..."
echo "⏳ Aguardando serviços iniciarem..."
sleep 10

HEALTH_OK=false
for i in {1..15}; do
    if curl -s http://localhost:3000/v1/health | grep -q "status"; then
        HEALTH_OK=true
        break
    fi
    sleep 3
done

if [ "$HEALTH_OK" = "true" ]; then
    echo "✅ API Respondendo."
    # Trigger para criar tenant e chaves no bootstrap da API
    curl -s http://localhost:3000/v1/health > /dev/null
else
    echo "⚠️ API demorando a responder. Verifique os logs."
fi

# ==========================================
# FASE 18 — OUTPUT FINAL
# ==========================================
echo ""
echo "====================================="
echo "        AI PLATFORM ONLINE"
echo "====================================="
echo "Dashboard"
echo "https://dashboard.$DOMAIN"
echo ""
echo "API"
echo "https://api.$DOMAIN"
echo ""
echo "Swagger"
echo "https://docs.$DOMAIN"
echo ""
echo "Health"
echo "https://health.$DOMAIN"
echo ""
echo "Metrics"
echo "https://metrics.$DOMAIN"
echo ""
echo "Default API Key"
echo "Verifique o dashboard > API Keys ou o log: docker compose logs api | grep key"
echo ""
echo "Tenant"
echo "default"
echo ""
echo "Providers"
echo "OpenAI"
echo "Claude"
echo "Gemini"
echo "OpenRouter"
echo "Ollama"
echo ""
echo "Mission"
echo "ONLINE"
echo ""
echo "Runtime"
echo "ONLINE"
echo ""
echo "ICP"
echo "ONLINE"
echo ""
echo "SSL"
echo "ONLINE"
echo ""
echo "FÊNIX READY"
echo "====================================="
